const { MongoClient } = require("mongodb");

let client;
let database;

// Collection names used across the app
const USERS = "users";
const PROJECTS = "projects";
const MEMBERSHIPS = "projectmemberships";
const USER_STORIES = "userstories";

async function connectToDatabase() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "pa2_login_signup";

  if (!uri) {
    throw new Error("MONGODB_URI is not set. Add it to your .env file.");
  }

  client = new MongoClient(uri);
  await client.connect();
  database = client.db(dbName);

  // Database-level unique constraint prevents duplicate usernames even
  // if two signup requests arrive at nearly the same time.
  await database.collection(USERS).createIndex(
    { username: 1 },
    { unique: true } // Only unique usernames
  );

  // Make sure the projects collection exists even before the first project is saved.
  await database.collection(PROJECTS).createIndex({ created_at: -1 });

  // A user can only be in a given project once (many-to-many join collection).
  // createIndex also creates the collection if it does not exist yet.
  await database.collection(MEMBERSHIPS).createIndex(
    { project_id: 1, user_id: 1 },
    { unique: true }
  );

  // Stories are always looked up by project (and by assignee when checking member removal).
  // createIndex also creates the UserStories collection if it does not exist yet.
  await database.collection(USER_STORIES).createIndex({ project_id: 1, assigned_user_id: 1 });

  console.log(`Connected to MongoDB: ${dbName}`);
  return database;
}

function getDb() {
  if (!database) {
    throw new Error("Database has not been connected.");
  }
  return database;
}

async function closeDatabase() {
  if (client) await client.close();
}

module.exports = {
  connectToDatabase,
  getDb,
  closeDatabase,
  USERS,
  PROJECTS,
  MEMBERSHIPS,
  USER_STORIES
};
