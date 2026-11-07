import { useEffect, useRef, useState } from "react";

// Empty object of our fields
const emptySignup = {
  firstName: "",
  lastName: "",
  username: "",
  password: ""
};

const emptyProject = {
  name: "",
  description: "",
  status: "Planning",
  project_lead_id: "",
};

const PRIORITIES = ["High", "Medium", "Low"];
const STORY_STATUSES = ["To Do", "In Progress", "Done"];

const emptyStory = {
  title: "",
  description: "",
  priority: "Medium",
  assigned_user_id: ""
};

export default function App() {

  const [page, setPage] = useState("signup");
  const [signup, setSignup] = useState(emptySignup);
  const [login, setLogin] = useState({ username: "", password: "" });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [users, setUsers] = useState([]);
  const [project, setProject] = useState(emptyProject);
  const [projects, setProjects] = useState([]);

  // Membership management state
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [members, setMembers] = useState([]);
  const [userToAdd, setUserToAdd] = useState("");

  // User story state
  const [storyProjectId, setStoryProjectId] = useState("");
  const storyProjectRef = useRef(""); // guards against stale responses when switching projects
  const [stories, setStories] = useState([]);
  const [storyMembers, setStoryMembers] = useState([]);
  const [storyForm, setStoryForm] = useState(emptyStory);
  const [openStoryId, setOpenStoryId] = useState(null);
  const [editingStoryId, setEditingStoryId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const updateProject = (event) => {
    const { name, value } = event.target;
    setProject(current => ({
      ...current,
      [name]: value
    }));
  };

  async function loadUsers() {
    try {
      const response = await fetch("/api/users");
      if (!response.ok) { throw new Error("Failed to load registered users."); }
      const data = await response.json();
      setUsers(data);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function loadProjects() {
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) { throw new Error("Failed to load projects."); }
      const data = await response.json();
      setProjects(data);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function loadMembers(projectId) {
    if (!projectId) {
      setMembers([]);
      return;
    }
    try {
      const response = await fetch(`/api/projects/${projectId}/members`);
      if (!response.ok) { throw new Error("Failed to load project members."); }
      const data = await response.json();
      setMembers(data);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  useEffect(() => {
    if (page === "projects") {
      loadUsers();
    }
    if (page === "view-projects") {
      loadProjects();
    }
    if (page === "manage-projects") {
      loadUsers();
      loadProjects();
    }
    if (page === "stories") {
      loadProjects();
      if (storyProjectId) loadStoryData(storyProjectId); // membership/stories may have changed elsewhere
    }
  }, [page]);

  // Reload the member list whenever a different project is selected
  useEffect(() => {
    if (page === "manage-projects") {
      setUserToAdd("");
      loadMembers(selectedProjectId);
    }
  }, [selectedProjectId, page]);

  async function addMember(event) {
    event.preventDefault();
    setNotice(null);

    if (!selectedProjectId || !userToAdd) {
      setNotice({ type: "error", text: "Please select a project and a user to add." });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${selectedProjectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userToAdd })
      });
      const data = await response.json();
      setNotice({
        type: response.ok ? "success" : "error",
        text: data.message || "Add member request finished."
      });
      if (response.ok) setUserToAdd("");
      await loadMembers(selectedProjectId); // refresh the displayed list
    } catch {
      setNotice({ type: "error", text: "Could not contact the server." });
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId) {
    setNotice(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${selectedProjectId}/members/${userId}`, {
        method: "DELETE"
      });
      const data = await response.json();
      setNotice({
        type: response.ok ? "success" : "error",
        text: data.message || "Remove member request finished."
      });
      await loadMembers(selectedProjectId); // refresh the displayed list
    } catch {
      setNotice({ type: "error", text: "Could not contact the server." });
    } finally {
      setBusy(false);
    }
  }

  // #############################################################
  // User stories
  // #############################################################

  async function loadStoryData(projectId) {
    if (!projectId) {
      setStories([]);
      setStoryMembers([]);
      return;
    }
    try {
      const [storyRes, memberRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/stories`),
        fetch(`/api/projects/${projectId}/members`)
      ]);
      if (!storyRes.ok || !memberRes.ok) { throw new Error("Failed to load the project backlog."); }
      const [storyData, memberData] = await Promise.all([storyRes.json(), memberRes.json()]);

      // Ignore the response if the user already switched to another project.
      if (storyProjectRef.current !== projectId) return;
      setStories(storyData);
      setStoryMembers(memberData);
    } catch (error) {
      if (storyProjectRef.current === projectId) {
        setNotice({ type: "error", text: error.message });
      }
    }
  }

  function selectStoryProject(projectId) {
    storyProjectRef.current = projectId;
    setStoryProjectId(projectId);
    // Changing projects clears the old backlog, open details and any edit form.
    setStories([]);
    setStoryMembers([]);
    setStoryForm(emptyStory);
    setOpenStoryId(null);
    setEditingStoryId(null);
    setEditForm(null);
    setNotice(null);
    loadStoryData(projectId);
  }

  function updateStoryForm(event) {
    const { name, value } = event.target;
    setStoryForm(current => ({ ...current, [name]: value }));
  }

  function updateEditForm(event) {
    const { name, value } = event.target;
    setEditForm(current => ({ ...current, [name]: value }));
  }

  async function createStory(event) {
    event.preventDefault();
    setNotice(null);

    if (!storyForm.title.trim() || !storyForm.description.trim() || !storyForm.priority) {
      setNotice({ type: "error", text: "Title, description, and priority are required." });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${storyProjectId}/stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...storyForm,
          assigned_user_id: storyForm.assigned_user_id || null
        })
      });
      const data = await response.json();
      setNotice({
        type: response.ok ? "success" : "error",
        text: data.message || "Create story request finished."
      });
      if (response.ok) setStoryForm(emptyStory);
      await loadStoryData(storyProjectId);
    } catch {
      setNotice({ type: "error", text: "Could not contact the server." });
    } finally {
      setBusy(false);
    }
  }

  function startEditStory(story) {
    setNotice(null);
    setEditingStoryId(story._id);
    setEditForm({
      title: story.title,
      description: story.description,
      priority: story.priority,
      status: story.status,
      assigned_user_id: story.assigned_user_id || ""
    });
  }

  function cancelEditStory() {
    setEditingStoryId(null);
    setEditForm(null);
  }

  async function saveStory(event) {
    event.preventDefault();
    setNotice(null);

    if (!editForm.title.trim() || !editForm.description.trim()) {
      setNotice({ type: "error", text: "Title, description, and priority are required." });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/stories/${editingStoryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          assigned_user_id: editForm.assigned_user_id || null
        })
      });
      const data = await response.json();
      setNotice({
        type: response.ok ? "success" : "error",
        text: data.message || "Update story request finished."
      });
      if (response.ok) cancelEditStory();
      await loadStoryData(storyProjectId);
    } catch {
      setNotice({ type: "error", text: "Could not contact the server." });
    } finally {
      setBusy(false);
    }
  }

  async function deleteStory(story) {
    if (!window.confirm(`Delete the story "${story.title}"? This cannot be undone.`)) {
      return; // Cancel leaves the story unchanged
    }

    setNotice(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/stories/${story._id}`, { method: "DELETE" });
      const data = await response.json();
      setNotice({
        type: response.ok ? "success" : "error",
        text: data.message || "Delete story request finished."
      });
      if (response.ok) {
        if (openStoryId === story._id) setOpenStoryId(null);
        if (editingStoryId === story._id) cancelEditStory();
      }
      await loadStoryData(storyProjectId);
    } catch {
      setNotice({ type: "error", text: "Could not contact the server." });
    } finally {
      setBusy(false);
    }
  }

  // send the project object to backend server
  async function submitProject(event) {
    event.preventDefault();
    setNotice(null);

    if (!project.name.trim() || !project.description.trim() || !project.project_lead_id) {
      setNotice({ type: "error", text: "Please complete all project fields." });
      return;
    }

    setBusy(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });

      const data = await response.json();
      setNotice({
        type: response.ok ? "success" : "error",
        text: data.message || "Project request finished."
      });

      if (response.ok) {
        setProject(emptyProject);
      }
    } catch {
      setNotice({ type: "error", text: "Could not contact the server." });
    } finally {
      setBusy(false);
    }
  }

  function changePage(nextPage) {
    setPage(nextPage);
    setNotice(null);
  }

  function updateSignup(event) {
    const { name, value } = event.target;
    setSignup(current => ({ ...current, [name]: value }));
  }

  function updateLogin(event) {
    const { name, value } = event.target;
    setLogin(current => ({ ...current, [name]: value }));
  }

  async function submitSignup(event) {
    event.preventDefault();
    setNotice(null);

    if (Object.values(signup).some(value => !value.trim())) {
      setNotice({ type: "error", text: "Please fill in every field." });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signup)
      });
      const data = await response.json();
      setNotice({
        type: response.ok ? "success" : "error",
        text: data.message || "Signup request finished."
      });

      if (response.ok) {
        setSignup(emptySignup);
        setLogin(current => ({ ...current, username: signup.username, password: "" }));
      }
    } catch {
      setNotice({
        type: "error",
        text: "Could not contact the server. Make sure the backend is running."
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    setNotice(null);

    if (!login.username.trim() || !login.password.trim()) {
      setNotice({ type: "error", text: "Please enter both username and password." });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(login)
      });
      const data = await response.json();
      setNotice({
        type: response.ok ? "success" : "error",
        text: data.message || "Login request finished."
      });
      if (response.ok) setLogin(current => ({ ...current, password: "" }));
    } catch {
      setNotice({ type: "error", text: "Could not contact the server." });
    } finally {
      setBusy(false);
    }
  }

  // Users who are not yet members of the selected project
  const memberIds = new Set(members.map(m => String(m.user_id)));
  const availableUsers = users.filter(u => !memberIds.has(String(u._id)));

  const tabs = [
    ["signup", "Sign up"],
    ["login", "Log in"],
    ["projects", "Projects"],
    ["view-projects", "View Projects"],
    ["manage-projects", "Manage Project Memberships"],
    ["stories", "User Stories"],
  ];

  // Render the appropriate page based on the current state
  // Each page has its own form and functionality, with conditional rendering based on the `page` state.
  // The notice area displays success or error messages based on user actions.
  return (
    <main className="page">
      <section className="auth-card">
        <div className="brand-mark" aria-hidden="true">ICSI</div>
        <h1>Welcome</h1>
        <p className="subtitle">Sign up or log in to continue.</p>

        <div className="tabs" role="tablist" aria-label="Authentication">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              className={page === key ? "tab active" : "tab"}
              onClick={() => changePage(key)}
              role="tab"
              aria-selected={page === key}
              type="button">
              {label}
            </button>
          ))}
        </div>

        {notice && (
          <div className={`notice ${notice.type}`} role="status">
            {notice.text}
          </div>
        )}

        {page === "signup" ? (
          <form onSubmit={submitSignup}>
            <div className="name-row">
              <label>
                First name
                <input name="firstName" value={signup.firstName}
                  onChange={updateSignup}
                  placeholder="First Name" />
              </label>
              <label>
                Last name
                <input name="lastName" value={signup.lastName}
                  onChange={updateSignup}
                  placeholder="Last Name" />
              </label>
            </div>
            <label>
              Username
              <input name="username" value={signup.username}
                onChange={updateSignup} placeholder="Choose a username"
                autoComplete="username" maxLength="32" />
            </label>
            <label>
              Password
              <input name="password" type="password" value={signup.password}
                onChange={updateSignup} placeholder="At least 8 characters"
                autoComplete="new-password" />
            </label>
            <button className="submit" type="submit" disabled={busy}>
              {busy ? "Creating account..." : "Create account"}
            </button>
          </form>
        ) : page === "login" ? (
          <form onSubmit={submitLogin}>
            <label>
              Username
              <input name="username" value={login.username}
                onChange={updateLogin} placeholder="Your username"
                autoComplete="username" />
            </label>
            <label>
              Password
              <input name="password" type="password" value={login.password}
                onChange={updateLogin} placeholder="Your password"
                autoComplete="current-password" />
            </label>
            <button className="submit" type="submit" disabled={busy}>
              {busy ? "Logging in..." : "Log in"}
            </button>
          </form>
        ) : page === "projects" ? (
          <form onSubmit={submitProject}>
            <h2>Create Project</h2>
            <p className="subtitle">
              Add a new project to display.
            </p>

            <label>
              Project Name
              <input name="name" value={project.name} onChange={updateProject} placeholder="Enter project name"
                maxLength={100}
                required />
            </label>

            <label>
              Description
              <textarea name="description" value={project.description} onChange={updateProject} placeholder="Describe the project"
                required />
            </label>

            <label>
              Status
              <select name="status" value={project.status} onChange={updateProject} required>
                <option value="Planning">Planning</option>
                <option value="Active">Active</option>
                <option value="Completed">Completed</option>
              </select>
            </label>

            <label>
              Project Lead
              <select name="project_lead_id" value={project.project_lead_id} onChange={updateProject} required>
                <option value="">Select a project lead</option>
                {users.map((user) => (
                  <option key={user._id} value={user._id}>
                    {user.f_name} {user.l_name} ({user.username})
                  </option>
                ))}
              </select>
            </label>

            <button className="submit" type="submit" disabled={busy}>
              {busy ? "Creating project..." : "Create Project"}
            </button>
          </form>
        ) : page === "view-projects" ? (
          <div className="project-list">
            <h2>Projects</h2>

            {projects.length === 0 ? (
              <p className="subtitle">No projects have been created yet.</p>
            ) : (
              projects.map((p) => (
                <article className="project-card" key={p._id}>
                  <h3>{p.name}</h3>
                  <p><strong>Description:</strong> {p.description}</p>
                  <p><strong>Status:</strong> {p.status}</p>
                  <p>
                    <strong>Project Lead:</strong> {p.lead_name}
                    {p.lead_username && ` (${p.lead_username})`}
                  </p>
                </article>
              ))
            )}
          </div>
        ) : page === "manage-projects" ? (
          <div className="project-list">
            <h2>Manage Project Memberships</h2>

            <label>
              Project
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}>
                <option value="">Select a project</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))}
              </select>
            </label>

            {selectedProjectId && (
              <>
                <h3>Current Members</h3>
                {members.length === 0 ? (
                  <p className="subtitle">This project has no members yet.</p>
                ) : (
                  members.map((m) => (
                    <article className="project-card" key={m._id}>
                      <p>
                        <strong>{m.f_name} {m.l_name}</strong> ({m.username})
                        {m.is_lead && " — Project Lead"}
                      </p>
                      {!m.is_lead && (
                        <button
                          className="submit"
                          type="button"
                          disabled={busy}
                          onClick={() => removeMember(m.user_id)}>
                          Remove
                        </button>
                      )}
                    </article>
                  ))
                )}

                <h3>Add Member</h3>
                <form onSubmit={addMember}>
                  <label>
                    Registered user
                    <select value={userToAdd} onChange={(e) => setUserToAdd(e.target.value)}>
                      <option value="">Select a user</option>
                      {availableUsers.map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.f_name} {u.l_name} ({u.username})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="submit" type="submit" disabled={busy || !userToAdd}>
                    {busy ? "Working..." : "Add to project"}
                  </button>
                </form>
              </>
            )}
          </div>
        ) : (
          <div className="project-list">
            <h2>User Stories</h2>

            <label>
              Project
              <select
                value={storyProjectId}
                onChange={(e) => selectStoryProject(e.target.value)}>
                <option value="">Select a project</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))}
              </select>
            </label>

            {storyProjectId && (
              <>
                <h3>Create User Story</h3>
                <form onSubmit={createStory}>
                  <label>
                    Title
                    <input name="title" value={storyForm.title} onChange={updateStoryForm}
                      placeholder="Story Title" maxLength={100} />
                  </label>
                  <label>
                    Description
                    <textarea name="description" value={storyForm.description} onChange={updateStoryForm}
                      placeholder="As a [type of user], I want [goal], so that [benefit]." />
                  </label>
                  <label>
                    Priority
                    <select name="priority" value={storyForm.priority} onChange={updateStoryForm}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                  <label>
                    Assigned Member
                    <select name="assigned_user_id" value={storyForm.assigned_user_id} onChange={updateStoryForm}>
                      <option value="">Unassigned</option>
                      {storyMembers.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.f_name} {m.l_name} ({m.username})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="submit" type="submit" disabled={busy}>
                    {busy ? "Working..." : "Create story"}
                  </button>
                </form>

                <h3>Project Backlog</h3>
                {stories.length === 0 ? (
                  <p className="subtitle">This project has no user stories yet.</p>
                ) : (
                  stories.map((story) => (
                    <article className="project-card" key={story._id}>
                      {editingStoryId === story._id && editForm ? (
                        <form onSubmit={saveStory}>
                          <label>
                            Title
                            <input name="title" value={editForm.title} onChange={updateEditForm} maxLength={100} />
                          </label>
                          <label>
                            Description
                            <textarea name="description" value={editForm.description} onChange={updateEditForm} />
                          </label>
                          <label>
                            Priority
                            <select name="priority" value={editForm.priority} onChange={updateEditForm}>
                              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </label>
                          <label>
                            Status
                            <select name="status" value={editForm.status} onChange={updateEditForm}>
                              {STORY_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                            </select>
                          </label>
                          <label>
                            Assigned Member
                            <select name="assigned_user_id" value={editForm.assigned_user_id} onChange={updateEditForm}>
                              <option value="">Unassigned</option>
                              {storyMembers.map((m) => (
                                <option key={m.user_id} value={m.user_id}>
                                  {m.f_name} {m.l_name} ({m.username})
                                </option>
                              ))}
                            </select>
                          </label>
                          <button className="submit" type="submit" disabled={busy}>Save</button>
                          <button className="submit" type="button" disabled={busy} onClick={cancelEditStory}>
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <h3>{story.title}</h3>
                          <p><strong>Priority:</strong> {story.priority}</p>
                          <p><strong>Status:</strong> {story.status}</p>
                          <p>
                            <strong>Assigned:</strong>{" "}
                            {story.assigned_user_id
                              ? `${story.assigned_name || "Unknown user"}${story.assigned_username ? ` (${story.assigned_username})` : ""}`
                              : "Unassigned"}
                          </p>
                          {openStoryId === story._id && (
                            <p><strong>Description:</strong> {story.description}</p>
                          )}
                          <button className="submit" type="button" disabled={busy}
                            onClick={() => setOpenStoryId(openStoryId === story._id ? null : story._id)}>
                            {openStoryId === story._id ? "Hide details" : "View details"}
                          </button>
                          <button className="submit" type="button" disabled={busy}
                            onClick={() => startEditStory(story)}>
                            Edit
                          </button>
                          <button className="submit" type="button" disabled={busy}
                            onClick={() => deleteStory(story)}>
                            Delete
                          </button>
                        </>
                      )}
                    </article>
                  ))
                )}
              </>
            )}
          </div>
        )}

        {(page === "signup" || page === "login") && (
          <p className="footnote">
            {page === "signup" ? "Already have an account?" : "New here?"}{" "}
            <button className="text-button" type="button"
              onClick={() => changePage(page === "signup" ? "login" : "signup")}>
              {page === "signup" ? "Log in" : "Create an account"}
            </button>
          </p>
        )}

      </section>
      <p className="page-footer">ICSI 418Y· Assignment 4</p>
    </main>
  );
}
