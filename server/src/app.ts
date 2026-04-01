import express from "express";
import sessionRoutes from "./routes/sessions";
import dubbingRoutes from "./routes/dubbing";

const app = express();

app.use(express.json());

/** Health check */
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", engine: "format-shifting-engine", version: "1.0.0" });
});

/** Session & stream management */
app.use("/api/sessions", sessionRoutes);

/** Deep-Dubbing ML endpoints */
app.use("/api/dubbing", dubbingRoutes);

export default app;
