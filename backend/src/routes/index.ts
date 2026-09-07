import { Router } from "express";
import students from "./students";
import courses from "./courses";
import fees from "./fees";
import vouchers from "./vouchers";
import enrollments from "./enrollments";
import expenses from "./expenses";
import attendance from "./attendance";
import tests from "./tests";
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

// Module-level access control (mirrors the frontend permission matrix). Reads
// AND writes are denied to roles without access; per-route write guards inside
// each module still apply on top. students/enrollments/branches/settings/auth
// stay open because their reads feed dropdowns/profile used across the app.
router.use("/students", students);       // all roles (view+); writes guarded inside
router.use("/enrollments", enrollments); // student-profile enroll/transfer; writes guarded inside
router.use("/branches", branches);       // GET feeds dropdowns everywhere; writes are entity_admin-only inside
router.use("/settings", settings);       // GET /profile used for letterheads; writes entity_admin-only inside
router.use("/auth", auth);               // /me open; /users guarded inside (entity_admin/branch_manager)

router.use("/courses", requireRole("entity_admin", "branch_manager", "teacher"), courses);
router.use("/attendance", requireRole("entity_admin", "branch_manager", "teacher"), attendance);
router.use("/tests", requireRole("entity_admin", "branch_manager", "teacher"), tests);
router.use("/fees", requireRole("entity_admin", "branch_manager", "accountant"), fees);
router.use("/expenses", requireRole("entity_admin", "branch_manager", "accountant"), expenses);
router.use("/reminders", requireRole("entity_admin", "branch_manager", "accountant"), reminders);
router.use("/vouchers", requireRole("entity_admin", "branch_manager", "accountant", "front_desk"), vouchers);
router.use("/inquiries", requireRole("entity_admin", "branch_manager", "front_desk"), inquiries);
router.use("/audit", audit);             // entity_admin-only inside
router.use("/admin", requireRole("super_admin"), admin); // platform super-admin only
router.use(stats); // /dashboard (all) and /reports (finance roles — guarded inside stats)

export default router;
