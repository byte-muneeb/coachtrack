import { Router } from "express";
import students from "./students";
import courses from "./courses";
import fees from "./fees";
import vouchers from "./vouchers";
import enrollments from "./enrollments";
import expenses from "./expenses";
import stats from "./stats";
import branches from "./branches";
import inquiries from "./inquiries";
import reminders from "./reminders";
import settings from "./settings";
import auth from "./auth";
import audit from "./audit";
import admin from "./admin";
import { requireRole } from "../auth";

const router = Router();

// Functional modules (MS SQL).
router.use("/students", students);
router.use("/courses", courses);
router.use("/fees", fees);
router.use("/vouchers", vouchers);
router.use("/enrollments", enrollments);
router.use("/expenses", expenses);
router.use("/branches", branches);
router.use("/inquiries", inquiries);
router.use("/reminders", reminders);
router.use("/settings", settings);
router.use("/auth", auth);   // /me, /users (login is mounted publicly in app.ts)
router.use("/audit", audit);
router.use("/admin", requireRole("super_admin"), admin); // platform super-admin only
router.use(stats); // /dashboard and /reports (live aggregates)

export default router;
