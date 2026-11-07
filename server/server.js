require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { ObjectId } = require("mongodb");
const { connectToDatabase, getDb, closeDatabase, MEMBERSHIPS, USER_STORIES } = require("./db");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Constants
const PASS_CHAR_MIN = 8;
const USERNAME_LIMIT = 32;
const PROJECT_NAME_LIMIT = 100;
const VALID_STATUSES = ["Planning", "Active", "Completed"];
const VALID_PRIORITIES = ["High", "Medium", "Low"];
const VALID_STORY_STATUSES = ["To Do", "In Progress", "Done"];
const STORY_TITLE_LIMIT = 100;
const STORY_DESCRIPTION_LIMIT = 1000;

app.use(cors());
app.use(express.json());

// Helper Functions

// Returns an ObjectId if `value` is a valid 24-char hex id, otherwise null.
function parseObjectId(value) {
  const str = String(value ?? "");
  if (!/^[0-9a-fA-F]{24}$/.test(str)) return null;
  return new ObjectId(str);
}

// Makes sure the project lead has a membership document (ObjectId references).
// Needed so older projects (created before memberships existed) get backfilled.
async function ensureLeadMembership(db, project) {
  const leadOid = parseObjectId(project.project_lead_id);
  if (!leadOid) return null;

  try {
    await db.collection(MEMBERSHIPS).updateOne(
      { project_id: project._id, user_id: leadOid },
      { $setOnInsert: { project_id: project._id, user_id: leadOid } },
      { upsert: true }
    );
  } catch (error) {
    // Two requests racing against the unique index is fine - the row exists.
    if (!(error && error.code === 11000)) throw error;
  }
  return leadOid;
}

// Validates the editable story fields. Returns { error } or { value }.
function readStoryFields(body, requireStatus) {
  const { title, description, priority, status } = body || {};

  if (
    typeof title !== "string" || !title.trim() ||
    typeof description !== "string" || !description.trim() ||
    typeof priority !== "string" || !priority.trim()
  ) {
    return { error: "Title, description, and priority are required." };
  }
  if (title.trim().length > STORY_TITLE_LIMIT) {
    return { error: `Title must be ${STORY_TITLE_LIMIT} characters or fewer.` };
  }
  if (description.trim().length > STORY_DESCRIPTION_LIMIT) {
    return { error: `Description must be ${STORY_DESCRIPTION_LIMIT} characters or fewer.` };
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    return { error: "Priority must be High, Medium, or Low." };
  }
  if (requireStatus && !VALID_STORY_STATUSES.includes(status)) {
    return { error: "Status must be To Do, In Progress, or Done." };
  }

  return {
    value: { title: title.trim(), description: description.trim(), priority, status }
  };
}

// Resolves the assigned user for a story. Returns { userOid } (null = Unassigned) or { error, code }.
// The user must exist AND be a current member of the given project.
async function resolveAssignee(db, projectOid, raw) {
  if (raw === undefined || raw === null || raw === "") {
    return { userOid: null };
  }

  const userOid = typeof raw === "string" ? parseObjectId(raw) : null;
  if (!userOid) {
    return { error: "Invalid assigned user id.", code: 400 };
  }

  const user = await db.collection("users").findOne({ _id: userOid });
  if (!user) {
    return { error: "The assigned user does not exist.", code: 400 };
  }

  const membership = await db.collection(MEMBERSHIPS).findOne({
    project_id: projectOid,
    user_id: userOid
  });
  if (!membership) {
    return { error: "The assigned user is not a member of this project.", code: 400 };
  }

  return { userOid };
}

// Sign-up:
//  validate input, check username, hash password, then insert.
app.post("/api/signup", async (req, res) => {
  try {
    const { firstName, lastName, username, password } = req.body || {};

    if (![firstName, lastName, username, password].every(
      value => typeof value === "string" && value.trim().length > 0
    )) {
      return res.status(400).json({
        success: false,
        message: "Please complete all four signup fields."
      });
    }

    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();
    const cleanUsername = username.trim();

    if (password.length < PASS_CHAR_MIN) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long."
      });
    }

    if (cleanUsername.length > USERNAME_LIMIT) {
      return res.status(400).json({
        success: false,
        message: `Username must be ${USERNAME_LIMIT} characters or fewer.`
      });
    }

    const users = getDb().collection("users");
    const existingUser = await users.findOne({ username: cleanUsername });

    if (existingUser) {
      return res.status(409).json({
        message: "That username is already used."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = {
      f_name: cleanFirst,
      l_name: cleanLast,
      username: cleanUsername,
      password: hashedPassword
    };

    const result = await users.insertOne(newUser);

    return res.status(201).json({
      message: "Account created successfully. You can now log in.",
      userId: result.insertedId
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({
        message: "That username is already taken. Please choose another."
      });
    }
    console.error("Signup error:", error);
    return res.status(500).json({
      message: "A server or database error occurred. Please try again."
    });
  }
});

// Login: find by username and compare the entered password to its hash.
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (![username, password].every(
      value => typeof value === "string" && value.trim().length > 0
    )) {
      return res.status(400).json({
        message: "Please enter both username and password."
      });
    }

    const user = await getDb().collection("users").findOne({
      username: username.trim()
    });

    if (!user) {
      return res.status(401).json({
        message: "Invalid username or password."
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid username or password."
      });
    }

    return res.status(200).json({
      message: `Login successful. Welcome, ${user.f_name}!`
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      message: "A server or database error occurred. Please try again."
    });
  }
});

// Create project: validate input, confirm the lead exists, insert the project,
// then add the lead as the first member.
app.post("/api/projects", async (req, res) => {
  try {
    const { name, description, status, project_lead_id } = req.body || {};

    if (![name, description, status, project_lead_id].every(
      value => typeof value === "string" && value.trim().length > 0
    )) {
      return res.status(400).json({
        message: "Please complete all project fields."
      });
    }

    const cleanName = name.trim();
    const cleanDescription = description.trim();

    if (cleanName.length > PROJECT_NAME_LIMIT) {
      return res.status(400).json({
        message: `Project name must be ${PROJECT_NAME_LIMIT} characters or fewer.`
      });
    }

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        message: "Status must be Planning, Active, or Completed."
      });
    }

    const leadOid = parseObjectId(project_lead_id.trim());
    if (!leadOid) {
      return res.status(400).json({
        message: "The selected project lead does not exist."
      });
    }

    const db = getDb();

    const lead = await db.collection("users").findOne({ _id: leadOid });
    if (!lead) {
      return res.status(400).json({
        message: "The selected project lead does not exist."
      });
    }

    const newProject = {
      name: cleanName,
      description: cleanDescription,
      status,
      project_lead_id: leadOid,   // ObjectId reference to users
      created_at: new Date()
    };

    const result = await db.collection("projects").insertOne(newProject);

    // The Project Lead must appear as a member of the project.
    await db.collection(MEMBERSHIPS).insertOne({
      project_id: result.insertedId,
      user_id: leadOid
    });

    return res.status(201).json({
      message: "Project created successfully.",
      projectId: result.insertedId
    });
  } catch (error) {
    console.error("Project creation error:", error);
    return res.status(500).json({
      message: "A server or database error occurred. Please try again."
    });
  }
});

// Get users from database
app.get("/api/users", async (req, res) => {
  try {
    const usersCollection = getDb().collection("users");
    const allNames = await usersCollection.find({})
      .project({ _id: 1, f_name: 1, l_name: 1, username: 1 })
      .sort({ l_name: 1, f_name: 1 }).toArray();
    res.status(200).json(allNames);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      message: "Failed to retrieve active users",
    });
  }
});

// Get all projects, with the project lead's name attached.
// Works whether project_lead_id was stored as a string (old projects) or an ObjectId (new ones).
app.get("/api/projects", async (req, res) => {
  try {
    const projects = await getDb().collection("projects").aggregate([
      {
        $lookup: {
          from: "users",
          let: { leadId: "$project_lead_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: [{ $toString: "$_id" }, { $toString: "$$leadId" }] }
              }
            },
            { $project: { f_name: 1, l_name: 1, username: 1 } }
          ],
          as: "lead"
        }
      },
      { $unwind: { path: "$lead", preserveNullAndEmptyArrays: true } },
      { $sort: { created_at: -1 } }
    ]).toArray();

    const result = projects.map(p => ({
      _id: p._id,
      name: p.name,
      description: p.description,
      status: p.status,
      created_at: p.created_at,
      lead_name: p.lead ? `${p.lead.f_name} ${p.lead.l_name}` : "Unknown",
      lead_username: p.lead ? p.lead.username : null
    }));

    return res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching projects:", error);
    return res.status(500).json({
      message: "Failed to retrieve projects."
    });
  }
});

// ---------- Project memberships ----------

// List members of a project (lead is flagged with is_lead).
app.get("/api/projects/:projectId/members", async (req, res) => {
  try {
    const projectOid = parseObjectId(req.params.projectId);
    if (!projectOid) {
      return res.status(400).json({ message: "Invalid project id." });
    }

    const db = getDb();
    const project = await db.collection("projects").findOne({ _id: projectOid });
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const leadOid = await ensureLeadMembership(db, project);

    const members = await db.collection(MEMBERSHIPS).aggregate([
      { $match: { project_id: projectOid } },
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 1,
          user_id: 1,
          f_name: "$user.f_name",
          l_name: "$user.l_name",
          username: "$user.username"
        }
      },
      { $sort: { l_name: 1, f_name: 1 } }
    ]).toArray();

    return res.status(200).json(
      members.map(m => ({
        ...m,
        is_lead: leadOid ? String(m.user_id) === String(leadOid) : false
      }))
    );
  } catch (error) {
    console.error("Error fetching members:", error);
    return res.status(500).json({ message: "Failed to retrieve project members." });
  }
});

// Add a user to a project.
app.post("/api/projects/:projectId/members", async (req, res) => {
  try {
    const projectOid = parseObjectId(req.params.projectId);
    const userOid = parseObjectId((req.body || {}).user_id);

    if (!projectOid) {
      return res.status(400).json({ message: "Invalid project id." });
    }
    if (!userOid) {
      return res.status(400).json({ message: "Please select a user to add." });
    }

    const db = getDb();

    const project = await db.collection("projects").findOne({ _id: projectOid });
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const user = await db.collection("users").findOne({ _id: userOid });
    if (!user) {
      return res.status(404).json({ message: "That user does not exist." });
    }

    // Make sure the lead's row exists before anything else.
    await ensureLeadMembership(db, project);

    const memberships = db.collection(MEMBERSHIPS);
    const existing = await memberships.findOne({ project_id: projectOid, user_id: userOid });
    if (existing) {
      return res.status(409).json({ message: "That user is already a member of this project." });
    }

    await memberships.insertOne({ project_id: projectOid, user_id: userOid });

    return res.status(201).json({
      message: `${user.f_name} ${user.l_name} was added to the project.`
    });
  } catch (error) {
    // Unique index (project_id + user_id) caught a race condition.
    if (error && error.code === 11000) {
      return res.status(409).json({ message: "That user is already a member of this project." });
    }
    console.error("Error adding member:", error);
    return res.status(500).json({ message: "Failed to add member." });
  }
});

// Remove a (non-lead) user from a project.
app.delete("/api/projects/:projectId/members/:userId", async (req, res) => {
  try {
    const projectOid = parseObjectId(req.params.projectId);
    const userOid = parseObjectId(req.params.userId);

    if (!projectOid || !userOid) {
      return res.status(400).json({ message: "Invalid project or user id." });
    }

    const db = getDb();

    const project = await db.collection("projects").findOne({ _id: projectOid });
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    // The current Project Lead can never be removed.
    if (String(project.project_lead_id) === String(userOid)) {
      return res.status(403).json({
        message: "The project lead cannot be removed from the project."
      });
    }

    // A member who still owns stories in THIS project (any status) cannot be removed.
    const assignedCount = await db.collection(USER_STORIES).countDocuments({
      project_id: projectOid,
      assigned_user_id: userOid
    });
    if (assignedCount > 0) {
      return res.status(409).json({
        message:
          `This member still has ${assignedCount} ${assignedCount === 1 ? "story" : "stories"} ` +
          "assigned in this project (including Done stories). " +
          "Reassign, unassign, or delete those stories before removing the member."
      });
    }

    const result = await db.collection(MEMBERSHIPS).deleteOne({
      project_id: projectOid,
      user_id: userOid
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "That user is not a member of this project." });
    }

    return res.status(200).json({ message: "Member removed from the project." });
  } catch (error) {
    console.error("Error removing member:", error);
    return res.status(500).json({ message: "Failed to remove member." });
  }
});

// User stories

// Get the backlog for a project (all statuses), with the assigned member's name.
app.get("/api/projects/:projectId/stories", async (req, res) => {
  try {
    const projectOid = parseObjectId(req.params.projectId);
    if (!projectOid) {
      return res.status(400).json({ message: "Invalid project id." });
    }

    const db = getDb();
    const project = await db.collection("projects").findOne({ _id: projectOid });
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const stories = await db.collection(USER_STORIES).aggregate([
      { $match: { project_id: projectOid } },
      {
        $lookup: {
          from: "users",
          localField: "assigned_user_id",
          foreignField: "_id",
          as: "assignee"
        }
      },
      { $unwind: { path: "$assignee", preserveNullAndEmptyArrays: true } },
      { $sort: { _id: 1 } }
    ]).toArray();

    return res.status(200).json(
      stories.map(st => ({
        _id: st._id,
        project_id: st.project_id,
        title: st.title,
        description: st.description,
        priority: st.priority,
        status: st.status,
        assigned_user_id: st.assigned_user_id || null,
        assigned_name: st.assignee ? `${st.assignee.f_name} ${st.assignee.l_name}` : null,
        assigned_username: st.assignee ? st.assignee.username : null
      }))
    );
  } catch (error) {
    console.error("Error fetching stories:", error);
    return res.status(500).json({ message: "Failed to retrieve user stories." });
  }
});

// Create a story. The backend always sets the status to "To Do".
app.post("/api/projects/:projectId/stories", async (req, res) => {
  try {
    const projectOid = parseObjectId(req.params.projectId);
    if (!projectOid) {
      return res.status(400).json({ message: "Invalid project id." });
    }

    const fields = readStoryFields(req.body, false);
    if (fields.error) {
      return res.status(400).json({ message: fields.error });
    }

    const db = getDb();
    const project = await db.collection("projects").findOne({ _id: projectOid });
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const assignee = await resolveAssignee(db, projectOid, (req.body || {}).assigned_user_id);
    if (assignee.error) {
      return res.status(assignee.code).json({ message: assignee.error });
    }

    const result = await db.collection(USER_STORIES).insertOne({
      project_id: projectOid,
      title: fields.value.title,
      description: fields.value.description,
      priority: fields.value.priority,
      status: "To Do",
      assigned_user_id: assignee.userOid
    });

    return res.status(201).json({
      message: "User story created successfully.",
      storyId: result.insertedId
    });
  } catch (error) {
    console.error("Error creating story:", error);
    return res.status(500).json({ message: "Failed to create user story." });
  }
});

// Edit a story. project_id is never changed; any story status may be set.
app.put("/api/stories/:storyId", async (req, res) => {
  try {
    const storyOid = parseObjectId(req.params.storyId);
    if (!storyOid) {
      return res.status(400).json({ message: "Invalid story id." });
    }

    const fields = readStoryFields(req.body, true);
    if (fields.error) {
      return res.status(400).json({ message: fields.error });
    }

    const db = getDb();
    const story = await db.collection(USER_STORIES).findOne({ _id: storyOid });
    if (!story) {
      return res.status(404).json({ message: "User story not found." });
    }

    // Assignment is checked against the story's ORIGINAL project.
    const assignee = await resolveAssignee(db, story.project_id, (req.body || {}).assigned_user_id);
    if (assignee.error) {
      return res.status(assignee.code).json({ message: assignee.error });
    }

    await db.collection(USER_STORIES).updateOne(
      { _id: storyOid },
      {
        $set: {
          title: fields.value.title,
          description: fields.value.description,
          priority: fields.value.priority,
          status: fields.value.status,
          assigned_user_id: assignee.userOid
        }
      }
    );

    return res.status(200).json({ message: "User story updated successfully." });
  } catch (error) {
    console.error("Error updating story:", error);
    return res.status(500).json({ message: "Failed to update user story." });
  }
});

// Delete a story.
app.delete("/api/stories/:storyId", async (req, res) => {
  try {
    const storyOid = parseObjectId(req.params.storyId);
    if (!storyOid) {
      return res.status(400).json({ message: "Invalid story id." });
    }

    const result = await getDb().collection(USER_STORIES).deleteOne({ _id: storyOid });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "User story not found." });
    }

    return res.status(200).json({ message: "User story deleted." });
  } catch (error) {
    console.error("Error deleting story:", error);
    return res.status(500).json({ message: "Failed to delete user story." });
  }
});

async function startServer() {
  try {
    await connectToDatabase(); // also creates the indexes (see db.js)

    const server = app.listen(PORT, () => {
      console.log(`Express server listening at http://localhost:${PORT}`);
    });

    const shutdown = async () => {
      server.close(async () => {
        await closeDatabase();
        process.exit(0);
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("Could not start server:", error.message);
    process.exit(1);
  }
}

startServer();
