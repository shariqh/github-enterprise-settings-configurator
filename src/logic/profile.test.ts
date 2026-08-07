import { describe, expect, it } from "vitest"
import {
  createDefaultPlanDraft,
  defaultProfile,
  reconcileDecisionState,
  transitionProfile,
} from "./profile"
import type { Setting } from "../types"

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

  it("creates isolated default draft records", () => {
    const first = createDefaultPlanDraft()
    const second = createDefaultPlanDraft()
    first.profile.licensedProducts.codeSecurity = "licensed"
    first.priorities.push("regulated-overlay")
    expect(second.profile.licensedProducts.codeSecurity).toBe("unlicensed")
    expect(second.priorities).toEqual(["secure-ghec"])
  })
})
