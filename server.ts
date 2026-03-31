import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";

const db = new Database("exam_rigor.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT,
    exam_month TEXT,
    subject_count INTEGER,
    negative_motivation TEXT,
    daily_goal_hours REAL DEFAULT 0,
    theme TEXT DEFAULT 'dark'
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL, -- 'core' or 'life'
    type TEXT NOT NULL, -- 'standard' or 'normal'
    standard_minutes INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS daily_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    date DATE DEFAULT (DATE('now')),
    is_completed BOOLEAN DEFAULT 0,
    FOREIGN KEY(task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    duration_seconds INTEGER,
    is_overtime BOOLEAN,
    overtime_reason TEXT,
    date DATE DEFAULT (DATE('now')),
    FOREIGN KEY(task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS benchmarks (
    task_name TEXT PRIMARY KEY,
    best_seconds INTEGER,
    last_seconds INTEGER
  );
`);

// Migration: Ensure 'theme' column exists in user_settings
try {
  db.prepare("SELECT theme FROM user_settings LIMIT 1").get();
} catch (e) {
  console.log("Adding 'theme' column to user_settings table...");
  db.exec("ALTER TABLE user_settings ADD COLUMN theme TEXT DEFAULT 'dark'");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/settings", (req, res) => {
    const settings = db.prepare("SELECT * FROM user_settings WHERE id = 1").get();
    res.json(settings || null);
  });

  app.post("/api/settings", (req, res) => {
    const { name, exam_month, subject_count, negative_motivation, daily_goal_hours, theme } = req.body;
    const exists = db.prepare("SELECT id FROM user_settings WHERE id = 1").get();
    
    if (exists) {
      db.prepare(`
        UPDATE user_settings 
        SET name = ?, exam_month = ?, subject_count = ?, negative_motivation = ?, daily_goal_hours = ?, theme = ?
        WHERE id = 1
      `).run(name, exam_month, subject_count, negative_motivation, daily_goal_hours || 0, theme || 'dark');
    } else {
      db.prepare(`
        INSERT INTO user_settings (id, name, exam_month, subject_count, negative_motivation, daily_goal_hours, theme)
        VALUES (1, ?, ?, ?, ?, ?, ?)
      `).run(name, exam_month, subject_count, negative_motivation, daily_goal_hours || 0, theme || 'dark');
    }
    res.json({ success: true });
  });

  // Task Routes
  app.get("/api/tasks/library", (req, res) => {
    const tasks = db.prepare("SELECT * FROM tasks ORDER BY name ASC").all();
    res.json(tasks);
  });

  app.get("/api/tasks/today", (req, res) => {
    const tasks = db.prepare(`
      SELECT dt.id as daily_id, t.*, dt.is_completed 
      FROM daily_tasks dt
      JOIN tasks t ON dt.task_id = t.id
      WHERE dt.date = DATE('now')
    `).all();
    res.json(tasks);
  });

  app.post("/api/tasks/today", (req, res) => {
    const { task_id } = req.body;
    const result = db.prepare(`
      INSERT INTO daily_tasks (task_id) VALUES (?)
    `).run(task_id);
    res.json({ id: result.lastInsertRowid });
  });

  app.post("/api/tasks", (req, res) => {
    const { name, category, type, standard_minutes } = req.body;
    try {
      const result = db.prepare(`
        INSERT INTO tasks (name, category, type, standard_minutes)
        VALUES (?, ?, ?, ?)
      `).run(name, category, type, standard_minutes);
      
      // Also add to today's list by default
      db.prepare("INSERT INTO daily_tasks (task_id) VALUES (?)").run(result.lastInsertRowid);
      
      res.json({ id: result.lastInsertRowid });
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        const existing = db.prepare("SELECT id FROM tasks WHERE name = ?").get() as { id: number };
        db.prepare("INSERT INTO daily_tasks (task_id) VALUES (?)").run(existing.id);
        res.json({ id: existing.id, added_existing: true });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });

  app.delete("/api/tasks/today/:id", (req, res) => {
    db.prepare("DELETE FROM daily_tasks WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/benchmarks", (req, res) => {
    const benchmarks = db.prepare("SELECT * FROM benchmarks").all();
    res.json(benchmarks);
  });

  app.post("/api/logs", (req, res) => {
    const { task_id, duration_seconds, is_overtime, overtime_reason, daily_id } = req.body;
    
    // Save log
    db.prepare(`
      INSERT INTO task_logs (task_id, duration_seconds, is_overtime, overtime_reason)
      VALUES (?, ?, ?, ?)
    `).run(task_id, duration_seconds, is_overtime ? 1 : 0, overtime_reason);

    // Mark daily task as completed
    if (daily_id) {
      db.prepare("UPDATE daily_tasks SET is_completed = 1 WHERE id = ?").run(daily_id);
    }

    // Update benchmark
    const task = db.prepare("SELECT name FROM tasks WHERE id = ?").get() as { name: string };
    const existingBenchmark = db.prepare("SELECT * FROM benchmarks WHERE task_name = ?").get() as any;

    if (!existingBenchmark || duration_seconds < existingBenchmark.best_seconds) {
      if (existingBenchmark) {
        db.prepare("UPDATE benchmarks SET best_seconds = ?, last_seconds = ? WHERE task_name = ?")
          .run(duration_seconds, duration_seconds, task.name);
      } else {
        db.prepare("INSERT INTO benchmarks (task_name, best_seconds, last_seconds) VALUES (?, ?, ?)")
          .run(task.name, duration_seconds, duration_seconds);
      }
    } else {
      db.prepare("UPDATE benchmarks SET last_seconds = ? WHERE task_name = ?")
        .run(duration_seconds, task.name);
    }

    res.json({ success: true });
  });

  app.get("/api/stats/today", (req, res) => {
    const stats = db.prepare(`
      SELECT 
        SUM(duration_seconds) as total_seconds,
        COUNT(CASE WHEN is_overtime = 1 THEN 1 END) as overtime_count
      FROM task_logs 
      WHERE date = DATE('now')
    `).get();
    res.json(stats);
  });

  app.get("/api/stats/weekly", (req, res) => {
    const stats = db.prepare(`
      SELECT 
        date,
        SUM(duration_seconds) as total_seconds,
        COUNT(CASE WHEN is_overtime = 1 THEN 1 END) as overtime_count
      FROM task_logs 
      WHERE date >= DATE('now', '-7 days')
      GROUP BY date
      ORDER BY date ASC
    `).all();
    res.json(stats);
  });

  app.get("/api/stats/subjects", (req, res) => {
    const stats = db.prepare(`
      SELECT 
        t.name as subject,
        SUM(tl.duration_seconds) as total_seconds
      FROM task_logs tl
      JOIN tasks t ON tl.task_id = t.id
      WHERE t.category = 'core'
      GROUP BY t.name
    `).all();
    res.json(stats);
  });

  app.get("/api/stats/timeline", (req, res) => {
    const stats = db.prepare(`
      SELECT 
        tl.duration_seconds,
        tl.date,
        t.name as task_name,
        t.category
      FROM task_logs tl
      JOIN tasks t ON tl.task_id = t.id
      WHERE tl.date = DATE('now')
      ORDER BY tl.id ASC
    `).all();
    res.json(stats);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
