import cookieParser from "cookie-parser";
import express, { Application, Request, Response } from "express";
import cors from "cors";

import config from "./config/index.js";
import apiRouter from "./routes/index.js";
import { globalErrorHandler } from "./middlewares/globalErrorHandler.js";
import { notFound } from "./middlewares/notFound.js";

const app: Application = express();

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  cors({
    origin: config.CLIENT_URL,
    credentials: true,
  }),
);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get("/", (_req: Request, res: Response) => {
  res.json({ success: true, message: "Mashjid Hisab API is running." });
});

app.use("/api", apiRouter);

// ---------------------------------------------------------------------------
// Error handling — must be last
// ---------------------------------------------------------------------------
app.use(notFound);
app.use(globalErrorHandler);

export default app;