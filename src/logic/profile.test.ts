import { describe, expect, it } from "vitest"
import {
  acceptDecisionValues,
  createDefaultPlanDraft,
  defaultProfile,
  reconcileDecisionState,
  reconcilePlanDraftState,
  transitionProfile,
} from "./profile"
import type { RecommendedSetting, Setting } from "../types"

const setting = (id: string, choices = ["strong", "light"]): Setting => ({
  id,
  domain: "Code security",
  title: id,
  prompt: id,
  choices: choices.map((choice) => ({ id: choice, label: choice, description: choice })),
  recommended: choices[0],
  rationale: id,
  tradeoff: id,
  prerequisites: id,
  consequences: id,
  scope: id,
  role: id,
  applyMethod: id,
  influence: "Protective",
  rolloutBand: "Low",
  ongoingBand: "Low",
  sources: [],
})

describe("profile transitions", () => {
  it("moves to deployment-compatible identity values", () => {
    const residency = transitionProfile(defaultProfile, { deployment: "residency" }).profile
    expect(residency).toMatchObject({
      deployment: "residency",
      basePlan: "enterprise",
      accountModel: "managed",
      authentication: "saml",
      provisioning: "scim",
      repositoryVisibility: "private-internal",
    })

    const ghes = transitionProfile(residency, { deployment: "ghes" }).profile
    expect(ghes).toMatchObject({
      deployment: "ghes",
      basePlan: "enterprise",
      accountModel: "instance",
      authentication: "saml",
      provisioning: "scim",
    })
  })

  it("enabling Copilot preserves unrelated capabilities and license choices", () => {
    const profile = {
      ...defaultProfile,
      licensedProducts: {
        ...defaultProfile.licensedProducts,
        secretProtection: "licensed" as const,
        codeSecurity: "licensed" as const,
      },
      planningScope: { actions: true, audit: true },
    }
    const transitioned = transitionProfile(profile, {
      licensedProducts: { ...profile.licensedProducts, copilot: "enterprise" },
    }).profile
    expect(transitioned.licensedProducts).toEqual({
      secretProtection: "licensed",
      codeSecurity: "licensed",
      codeQuality: "unlicensed",
      copilot: "enterprise",
    })
    expect(transitioned.planningScope).toEqual({ actions: true, audit: true })
  })

  it("removes only products made impossible by a deployment change", () => {
    const profile = {
      ...defaultProfile,
      licensedProducts: {
        secretProtection: "licensed" as const,
        codeSecurity: "licensed" as const,
        codeQuality: "licensed" as const,
        copilot: "enterprise" as const,
      },
    }
    const transitioned = transitionProfile(profile, { deployment: "ghes" })
    expect(transitioned.profile.licensedProducts).toEqual({
      secretProtection: "licensed",
      codeSecurity: "licensed",
      codeQuality: "unlicensed",
      copilot: "none",
    })
    expect(transitioned.notices.map((notice) => notice.code)).toEqual([
      "ghes-copilot-reset",
      "ghes-code-quality-reset",
    ])
  })

  it("includes Actions when Code Quality is enabled", () => {
    const transitioned = transitionProfile(
      { ...defaultProfile, planningScope: { actions: false, audit: true } },
      {
        licensedProducts: {
          ...defaultProfile.licensedProducts,
          codeQuality: "licensed",
        },
      },
    )
    expect(transitioned.profile.planningScope.actions).toBe(true)
    expect(transitioned.notices.at(-1)?.code).toBe("code-quality-actions-enabled")
  })

  it("does not resolve unknown identity fields when an unrelated field changes", () => {
    const unresolved = {
      ...defaultProfile,
      deployment: "ghes" as const,
      accountModel: "instance" as const,
      authentication: "unknown" as const,
      provisioning: "unknown" as const,
      repositoryVisibility: "unknown" as const,
    }
    const transitioned = transitionProfile(unresolved, { repositoryVisibility: "private-internal" })
    expect(transitioned.profile).toMatchObject({
      authentication: "unknown",
      provisioning: "unknown",
      repositoryVisibility: "private-internal",
    })
    expect(transitioned.notices).toEqual([])
  })
})

describe("decision reconciliation", () => {
  it("preserves inapplicable choices as dormant and clears review", () => {
    const reconciled = reconcileDecisionState({
      selections: { security: "strong", dependency: "light" },
      dormantSelections: {},
      reviewed: { security: true, dependency: true },
    }, [setting("dependency")])
    expect(reconciled.selections).toEqual({ dependency: "light" })
    expect(reconciled.dormantSelections).toEqual({ security: "strong" })
    expect(reconciled.reviewed).toEqual({ dependency: true })
  })

  it("restores dormant choices without silently restoring review", () => {
    const reconciled = reconcileDecisionState({
      selections: {},
      dormantSelections: { security: "strong" },
      reviewed: { security: true },
    }, [setting("security")])
    expect(reconciled.selections).toEqual({ security: "strong" })
    expect(reconciled.dormantSelections).toEqual({})
    expect(reconciled.reviewed).toEqual({})
    expect(reconciled.notices[0].code).toBe("restored-security")
  })

  it("removes stored state for a derived setting instead of preserving an override", () => {
    const derived = { ...setting("identity"), editable: false }
    const reconciled = reconcileDecisionState({
      selections: { identity: "light" },
      dormantSelections: {},
      reviewed: { identity: true },
    }, [derived])
    expect(reconciled.selections).toEqual({})
    expect(reconciled.dormantSelections).toEqual({})
    expect(reconciled.reviewed).toEqual({})
    expect(reconciled.notices[0]?.code).toBe("derived-identity")
  })

  it("normalizes imported active and dormant decisions against the resolved profile", () => {
    const normalized = reconcilePlanDraftState({
      ...createDefaultPlanDraft(),
      selections: {
        "enterprise-type": "ghes",
        "admin-redundancy": "three",
        "identity-lifecycle": "ghes-cas",
      },
      dormantSelections: { "allowed-actions": "verified" },
      reviewed: {
        "enterprise-type": true,
        "admin-redundancy": true,
        "identity-lifecycle": true,
      },
    })
    expect(normalized.state.selections).toEqual({
      "admin-redundancy": "three",
      "allowed-actions": "verified",
    })
    expect(normalized.state.dormantSelections).toEqual({})
    expect(normalized.state.reviewed).toEqual({ "admin-redundancy": true })
  })

  it("materializes accepted recommendations so later recommendation changes cannot rewrite reviewed values", () => {
    const recommendedSetting: RecommendedSetting = {
      setting: setting("security"),
      recommended: "strong",
      selected: "strong",
      disposition: "Recommended",
    }
    const accepted = acceptDecisionValues(
      { selections: {}, reviewed: {} },
      [recommendedSetting],
    )
    expect(accepted).toEqual({
      selections: { security: "strong" },
      reviewed: { security: true },
    })
  })

  it("creates isolated default draft records", () => {
    const first = createDefaultPlanDraft()
    const second = createDefaultPlanDraft()
    first.profile.licensedProducts.codeSecurity = "licensed"
    first.priorities.push("regulated-overlay")
    expect(second.profile.licensedProducts.codeSecurity).toBe("unlicensed")
    expect(second.priorities).toEqual(["secure-ghec"])
  })
})
