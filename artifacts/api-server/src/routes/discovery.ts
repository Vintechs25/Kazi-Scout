/**
 * Discovery Routes
 * API endpoints for CV-guided job discovery with role approval
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, jobsTable, userRolePreferencesTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

import {
  getUserRolePreferences,
  getUserEnabledRoles,
  updateRolePreference,
  addCustomRole,
  removeRolePreference,
  toggleRoleEnabled,
  setRolePriority,
  setRoleWeight,
  getUserDiscoverySettings,
  updateDiscoverySettings,
  setSearchFrequency,
  setPreferredSources,
  setExcludedSources,
  toggleKenyaSources,
  toggleGlobalRemoteSources,
  setDefaultFilters,
  getSelectedRolesForDiscovery,
  selectRolesForDiscovery,
  getSuggestedRoles,
  getRoleStatistics,
  generateDiscoveryGuidance,
  type UserRolePreference,
  type UserDiscoverySettings,
} from "../lib/discovery-role-approval";

import {
  discoverAndMatchJobsEnhanced,
  discoverJobsForRoles,
  discoverJobsForSelectedRoles,
  runScheduledDiscovery,
  scheduleNextDiscovery,
  verifyJobRequirementsForUser,
  matchJobToUserProfileEnhanced,
  getDiscoveryHistory,
  getDiscoveryStatistics,
  getSourcesWithUserPreferences,
  toggleSourceForUser,
  getAllRolesForUser,
  updateUserDiscoverySettings,
} from "../lib/job-search-service-enhanced";

import { verifyJobAgainstUserProfile, enhanceJobWithVerification } from "../lib/requirement-verification-system";
import { getParsedCv } from "../lib/cv-parser-enhanced";

const router: IRouter = Router();

// ============================================================================
// ROLE MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/user/roles - Get all role preferences for the user
 */
router.get("/user/roles", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const preferences = await getUserRolePreferences(accountId);
    const statistics = await getRoleStatistics(accountId);
    const suggestedRoles = await getSuggestedRoles(accountId);
    
    return res.json({
      success: true,
      preferences,
      statistics,
      suggestions: suggestedRoles,
    });
  } catch (err) {
    console.error("[Discovery] Error getting user roles:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to get user roles",
    });
  }
});

/**
 * GET /api/user/roles/enabled - Get enabled roles for discovery
 */
router.get("/user/roles/enabled", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { roles, preferences, searchQueries } = await getUserEnabledRoles(accountId);
    
    return res.json({
      success: true,
      roles,
      preferences,
      searchQueries,
    });
  } catch (err) {
    console.error("[Discovery] Error getting enabled roles:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to get enabled roles",
    });
  }
});

/**
 * POST /api/user/roles - Add a custom role
 */
router.post("/user/roles", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { roleTitle } = req.body;
    
    if (!roleTitle || typeof roleTitle !== "string") {
      return res.status(400).json({
        success: false,
        error: "roleTitle is required and must be a string",
      });
    }
    
    const newRole = await addCustomRole(accountId, roleTitle);
    
    return res.json({
      success: true,
      role: newRole,
    });
  } catch (err) {
    console.error("[Discovery] Error adding custom role:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to add custom role",
    });
  }
});

/**
 * PUT /api/user/roles/:roleId - Update a role preference
 */
router.put("/user/roles/:roleId", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const roleId = String(req.params.roleId);
    const updates = req.body;
    
    const updatedRole = await updateRolePreference(accountId, roleId, updates);
    
    if (!updatedRole) {
      return res.status(404).json({
        success: false,
        error: "Role not found",
      });
    }
    
    return res.json({
      success: true,
      role: updatedRole,
    });
  } catch (err) {
    console.error("[Discovery] Error updating role:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to update role",
    });
  }
});

/**
 * DELETE /api/user/roles - Clear all role preferences for the user
 */
router.delete("/user/roles", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    await db
      .delete(userRolePreferencesTable)
      .where(or(
        eq(userRolePreferencesTable.accountId, accountId),
        eq(userRolePreferencesTable.accountId, "primary"),
        eq(userRolePreferencesTable.accountId, "system")
      ));
    return res.json({
      success: true,
      message: "All role preferences cleared",
    });
  } catch (err) {
    console.error("[Discovery] Error clearing all roles:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to clear roles",
    });
  }
});

/**
 * DELETE /api/user/roles/:roleId - Remove a role preference
 */
router.delete("/user/roles/:roleId", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const roleId = String(req.params.roleId);
    
    const removed = await removeRolePreference(accountId, roleId);
    
    if (!removed) {
      return res.status(404).json({
        success: false,
        error: "Role not found",
      });
    }
    
    return res.json({
      success: true,
      message: "Role removed",
    });
  } catch (err) {
    console.error("[Discovery] Error removing role:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to remove role",
    });
  }
});

/**
 * POST /api/user/roles/bulk - Bulk manage roles (enable, disable, set priority, delete)
 */
router.post("/user/roles/bulk", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { action, roleIds, priority } = req.body || {};

    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      return res.status(400).json({ success: false, error: "roleIds array is required" });
    }

    if (action === "enable" || action === "disable") {
      const enabled = action === "enable";
      for (const id of roleIds) {
        await toggleRoleEnabled(accountId, id, enabled);
      }
      return res.json({ success: true, count: roleIds.length, action });
    } else if (action === "priority") {
      if (!priority || !["high", "medium", "low"].includes(priority)) {
        return res.status(400).json({ success: false, error: "Valid priority ('high', 'medium', 'low') is required" });
      }
      for (const id of roleIds) {
        await setRolePriority(accountId, id, priority);
      }
      return res.json({ success: true, count: roleIds.length, action, priority });
    } else if (action === "delete") {
      for (const id of roleIds) {
        await removeRolePreference(accountId, id);
      }
      return res.json({ success: true, count: roleIds.length, action });
    } else {
      return res.status(400).json({ success: false, error: "Invalid action. Supported: enable, disable, priority, delete" });
    }
  } catch (err: any) {
    console.error("[Discovery] Error in bulk roles:", err);
    return res.status(500).json({ success: false, error: err?.message || "Failed bulk role operation" });
  }
});

/**
 * PATCH /api/user/roles/:roleId/enable - Enable/disable a role
 */
router.patch("/user/roles/:roleId/enable", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const roleId = String(req.params.roleId);
    const { enabled } = req.body;
    
    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "enabled must be a boolean",
      });
    }
    
    const updatedRole = await toggleRoleEnabled(accountId, roleId, enabled);
    
    if (!updatedRole) {
      return res.status(404).json({
        success: false,
        error: "Role not found",
      });
    }
    
    return res.json({
      success: true,
      role: updatedRole,
    });
  } catch (err) {
    console.error("[Discovery] Error toggling role:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle role",
    });
  }
});

/**
 * PATCH /api/user/roles/:roleId/priority - Set role priority
 */
router.patch("/user/roles/:roleId/priority", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const roleId = String(req.params.roleId);
    const { priority } = req.body;
    
    if (!["high", "medium", "low"].includes(priority)) {
      return res.status(400).json({
        success: false,
        error: "priority must be 'high', 'medium', or 'low'",
      });
    }
    
    const updatedRole = await setRolePriority(accountId, roleId, priority);
    
    if (!updatedRole) {
      return res.status(404).json({
        success: false,
        error: "Role not found",
      });
    }
    
    return res.json({
      success: true,
      role: updatedRole,
    });
  } catch (err) {
    console.error("[Discovery] Error setting role priority:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to set role priority",
    });
  }
});

/**
 * PATCH /api/user/roles/:roleId/weight - Set role weight
 */
router.patch("/user/roles/:roleId/weight", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const roleId = String(req.params.roleId);
    const { weight } = req.body;
    
    if (typeof weight !== "number" || weight < 1 || weight > 100) {
      return res.status(400).json({
        success: false,
        error: "weight must be a number between 1 and 100",
      });
    }
    
    const updatedRole = await setRoleWeight(accountId, roleId, weight);
    
    if (!updatedRole) {
      return res.status(404).json({
        success: false,
        error: "Role not found",
      });
    }
    
    return res.json({
      success: true,
      role: updatedRole,
    });
  } catch (err) {
    console.error("[Discovery] Error setting role weight:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to set role weight",
    });
  }
});

/**
 * GET /api/user/roles/suggestions - Get suggested roles based on CV
 */
router.get("/user/roles/suggestions", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const suggestions = await getSuggestedRoles(accountId);
    
    return res.json({
      success: true,
      ...suggestions,
    });
  } catch (err) {
    console.error("[Discovery] Error getting role suggestions:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to get role suggestions",
    });
  }
});

/**
 * GET /api/user/roles/statistics - Get role statistics
 */
router.get("/user/roles/statistics", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const statistics = await getRoleStatistics(accountId);
    
    return res.json({
      success: true,
      ...statistics,
    });
  } catch (err) {
    console.error("[Discovery] Error getting role statistics:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to get role statistics",
    });
  }
});

// ============================================================================
// DISCOVERY SETTINGS ROUTES
// ============================================================================

/**
 * GET /api/user/discovery-settings - Get user discovery settings
 */
router.get("/user/discovery-settings", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const settings = await getUserDiscoverySettings(accountId);
    const enabledRoles = await getUserEnabledRoles(accountId);
    const sources = await getSourcesWithUserPreferences(accountId);
    const guidance = await generateDiscoveryGuidance(accountId);
    
    return res.json({
      success: true,
      settings,
      enabledRoles,
      sources,
      guidance,
    });
  } catch (err) {
    console.error("[Discovery] Error getting discovery settings:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to get discovery settings",
    });
  }
});

/**
 * PUT /api/user/discovery-settings - Update discovery settings
 */
router.put("/user/discovery-settings", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const updates = req.body;
    
    const updatedSettings = await updateUserDiscoverySettings(accountId, updates);
    
    return res.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (err) {
    console.error("[Discovery] Error updating discovery settings:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to update discovery settings",
    });
  }
});

/**
 * PATCH /api/user/discovery-settings/search-frequency - Set search frequency
 */
router.patch("/user/discovery-settings/search-frequency", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { frequency } = req.body;
    
    if (!["manual", "daily", "every_2_days", "weekly", "biweekly"].includes(frequency)) {
      return res.status(400).json({
        success: false,
        error: "Invalid frequency. Must be one of: manual, daily, every_2_days, weekly, biweekly",
      });
    }
    
    const updatedSettings = await setSearchFrequency(accountId, frequency);
    
    return res.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (err) {
    console.error("[Discovery] Error setting search frequency:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to set search frequency",
    });
  }
});

/**
 * PATCH /api/user/discovery-settings/kenya-sources - Toggle Kenya sources
 */
router.patch("/user/discovery-settings/kenya-sources", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { enabled } = req.body;
    
    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "enabled must be a boolean",
      });
    }
    
    const updatedSettings = await toggleKenyaSources(accountId, enabled);
    
    return res.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (err) {
    console.error("[Discovery] Error toggling Kenya sources:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle Kenya sources",
    });
  }
});

/**
 * PATCH /api/user/discovery-settings/global-remote - Toggle global remote sources
 */
router.patch("/user/discovery-settings/global-remote", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { enabled } = req.body;
    
    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "enabled must be a boolean",
      });
    }
    
    const updatedSettings = await toggleGlobalRemoteSources(accountId, enabled);
    
    return res.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (err) {
    console.error("[Discovery] Error toggling global remote sources:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle global remote sources",
    });
  }
});

/**
 * PATCH /api/user/discovery-settings/preferred-sources - Set preferred sources
 */
router.patch("/user/discovery-settings/preferred-sources", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { sourceIds } = req.body;
    
    if (!Array.isArray(sourceIds)) {
      return res.status(400).json({
        success: false,
        error: "sourceIds must be an array of source IDs",
      });
    }
    
    const updatedSettings = await setPreferredSources(accountId, sourceIds);
    
    return res.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (err) {
    console.error("[Discovery] Error setting preferred sources:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to set preferred sources",
    });
  }
});

/**
 * PATCH /api/user/discovery-settings/excluded-sources - Set excluded sources
 */
router.patch("/user/discovery-settings/excluded-sources", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { sourceIds } = req.body;
    
    if (!Array.isArray(sourceIds)) {
      return res.status(400).json({
        success: false,
        error: "sourceIds must be an array of source IDs",
      });
    }
    
    const updatedSettings = await setExcludedSources(accountId, sourceIds);
    
    return res.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (err) {
    console.error("[Discovery] Error setting excluded sources:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to set excluded sources",
    });
  }
});

/**
 * PATCH /api/user/discovery-settings/filters - Set default filters
 */
router.patch("/user/discovery-settings/filters", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const filters = req.body;
    
    const updatedSettings = await setDefaultFilters(accountId, filters);
    
    return res.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (err) {
    console.error("[Discovery] Error setting default filters:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to set default filters",
    });
  }
});

/**
 * GET /api/user/discovery-settings/selected-roles - Get selected roles for discovery
 */
router.get("/user/discovery-settings/selected-roles", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const selectedRoles = await getSelectedRolesForDiscovery(accountId);
    
    return res.json({
      success: true,
      selectedRoles,
    });
  } catch (err) {
    console.error("[Discovery] Error getting selected roles:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to get selected roles",
    });
  }
});

/**
 * POST /api/user/discovery-settings/selected-roles - Select roles for discovery
 */
router.post("/user/discovery-settings/selected-roles", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { roleIds } = req.body;
    
    if (!Array.isArray(roleIds)) {
      return res.status(400).json({
        success: false,
        error: "roleIds must be an array of role IDs",
      });
    }
    
    const updatedSettings = await selectRolesForDiscovery(accountId, roleIds);
    
    return res.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (err) {
    console.error("[Discovery] Error selecting roles:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to select roles",
    });
  }
});

// ============================================================================
// DISCOVERY EXECUTION ROUTES
// ============================================================================

/**
 * POST /api/discovery/run - Run job discovery with CV guidance
 */
router.post("/discovery/run", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const config = req.body;
    
    const result = await discoverAndMatchJobsEnhanced(accountId, {
      ...config,
      accountId,
    });
    
    return res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("[Discovery] Error running discovery:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to run discovery",
    });
  }
});

/**
 * POST /api/discovery/run-selected - Run discovery with selected roles
 */
router.post("/discovery/run-selected", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const config = req.body;
    
    const result = await discoverJobsForSelectedRoles(accountId, config);
    
    return res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("[Discovery] Error running discovery with selected roles:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to run discovery with selected roles",
    });
  }
});

/**
 * POST /api/discovery/run-now - Run scheduled discovery immediately
 */
router.post("/discovery/run-now", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const config = req.body || {};
    
    const result = await discoverAndMatchJobsEnhanced(accountId, {
      ...config,
      accountId,
    });
    
    return res.json({
      success: true,
      ran: true,
      ...result,
    });
  } catch (err) {
    console.error("[Discovery] Error running discovery run-now:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to run discovery",
    });
  }
});

/**
 * GET /api/discovery/history - Get discovery history
 */
router.get("/discovery/history", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { limit } = req.query;
    
    const history = await getDiscoveryHistory(
      accountId,
      limit ? parseInt(limit as string) : 50
    );
    
    return res.json({
      success: true,
      ...history,
    });
  } catch (err) {
    console.error("[Discovery] Error getting discovery history:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to get discovery history",
    });
  }
});

/**
 * GET /api/discovery/statistics - Get discovery statistics
 */
router.get("/discovery/statistics", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const statistics = await getDiscoveryStatistics(accountId);
    
    return res.json({
      success: true,
      ...statistics,
    });
  } catch (err) {
    console.error("[Discovery] Error getting discovery statistics:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to get discovery statistics",
    });
  }
});

/**
 * GET /api/discovery/guidance - Get discovery guidance
 */
router.get("/discovery/guidance", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const guidance = await generateDiscoveryGuidance(accountId);
    
    return res.json({
      success: true,
      ...guidance,
    });
  } catch (err) {
    console.error("[Discovery] Error getting discovery guidance:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to get discovery guidance",
    });
  }
});

/**
 * GET /api/discovery/sources - Get all available sources with user preferences
 */
router.get("/discovery/sources", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const sources = await getSourcesWithUserPreferences(accountId);
    
    // Group categories
    const categories: Record<string, any[]> = {};
    for (const s of (sources.allSources || [])) {
      const cat = s.category || "OTHER";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(s);
    }

    return res.json({
      success: true,
      sources: sources.allSources,
      ...sources,
      categories,
    });
  } catch (err) {
    console.error("[Discovery] Error getting sources:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to get sources",
    });
  }
});

/**
 * PATCH /api/discovery/sources/:sourceId - Toggle a source for the user
 */
router.patch("/discovery/sources/:sourceId", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const sourceId = String(req.params.sourceId);
    const { enabled } = req.body;
    
    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "enabled must be a boolean",
      });
    }
    
    const settings = await toggleSourceForUser(accountId, sourceId, enabled);
    
    return res.json({
      success: true,
      settings,
    });
  } catch (err) {
    console.error("[Discovery] Error toggling source:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle source",
    });
  }
});

// ============================================================================
// JOB VERIFICATION ROUTES
// ============================================================================

/**
 * POST /api/jobs/:jobId/verify - Verify a job's requirements against user's profile
 */
router.post("/jobs/:jobId/verify", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const jobId = String(req.params.jobId);
    
    const result = await verifyJobRequirementsForUser(jobId, accountId);
    
    return res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("[Discovery] Error verifying job:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to verify job",
    });
  }
});

/**
 * POST /api/jobs/:jobId/match - Get enhanced match details for a job
 */
router.post("/jobs/:jobId/match", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const jobId = String(req.params.jobId);
    
    // Get the job from database
    const [job] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }
    
    const matchResult = await matchJobToUserProfileEnhanced(job, accountId);
    
    return res.json({
      success: true,
      job,
      ...matchResult,
    });
  } catch (err) {
    console.error("[Discovery] Error matching job:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to match job",
    });
  }
});

/**
 * POST /api/jobs/verify-multiple - Verify requirements for multiple jobs
 */
router.post("/jobs/verify-multiple", requireAuth, async (req, res) => {
  try {
    const accountId = res.locals.accountId;
    const { jobIds } = req.body;
    
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "jobIds must be a non-empty array",
      });
    }
    
    const results = [];
    for (const jobId of jobIds) {
      try {
        const result = await verifyJobRequirementsForUser(jobId, accountId);
        results.push(result);
      } catch (err) {
        results.push({
          job: null,
          requirementVerification: null,
          canApply: false,
          canApplyReason: "",
          cannotApplyReason: err instanceof Error ? err.message : "Error verifying job",
          matchScore: 0,
          decision: "INELIGIBLE",
        });
      }
    }
    
    return res.json({
      success: true,
      results,
    });
  } catch (err) {
    console.error("[Discovery] Error verifying multiple jobs:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to verify multiple jobs",
    });
  }
});

// ============================================================================
// EXPORT
// ============================================================================

export default router;
