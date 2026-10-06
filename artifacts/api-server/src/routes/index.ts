import { Router, type IRouter } from "express";
import authRouter from "./auth";
import applicationsRouter from "./applications";
import agentRouter from "./agent";
import candidateRouter from "./candidate";
import cvsRouter from "./cvs";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import searchProfilesRouter from "./search-profiles";
import settingsRouter from "./settings";
import { requireAuth, requireSameOrigin } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireSameOrigin);
router.use(authRouter);
router.use(requireAuth);
router.use(dashboardRouter);
router.use(jobsRouter);
router.use(applicationsRouter);
router.use(candidateRouter);
router.use(searchProfilesRouter);
router.use(cvsRouter);
router.use(agentRouter);
router.use(settingsRouter);

export default router;
