import { describe, expect, it } from "vitest"
import {
  accountModels,
  authenticationMethods,
  basePlans,
  identityCompatibilityMatrix,
  isProfileValid,
  meetsCapabilityRequirement,
  provisioningMethods,
  resolveProfile,
} from "./capabilities"
import { defaultProfile } from "./profile"
import type {
  CopilotPlan,
  LicenseStatus,
  LicensedProductId,
  Profile,
} from "../types"

const profileFor = (
  combination: (typeof identityCompatibilityMatrix)[number],
): Profile => ({
  ...defaultProfile,
  ...combination,
  repositoryVisibility: combination.deployment === "residency"
    ? "private-internal"
    : "mixed",
  licensedProducts: { ...defaultProfile.licensedProducts },
  planningScope: { ...defaultProfile.planningScope },
})

describe("identity compatibility", () => {
  it.each(identityCompatibilityMatrix)(
    "accepts $deployment/$basePlan/$accountModel/$authentication/$provisioning",
    (combination) => {
      expect(resolveProfile(profileFor(combination)).errors).toEqual([])
    },
  )

  it("makes every concrete identity option reachable", () => {
    const dimensions = [
      [basePlans.filter((value) => value !== "unknown"), "basePlan"],
      [accountModels.filter((value) => value !== "unknown"), "accountModel"],
      [authenticationMethods.filter((value) => value !== "unknown"), "authentication"],
      [provisioningMethods.filter((value) => value !== "unknown"), "provisioning"],
    ] as const

    for (const [values, field] of dimensions) {
      for (const value of values) {
        expect(
          identityCompatibilityMatrix.some((combination) => combination[field] === value),
          `${field}=${value} should participate in a valid combination`,
        ).toBe(true)
      }
    }
  })

  it("rejects cross-deployment identity combinations", () => {
    expect(isProfileValid({
      ...defaultProfile,
      deployment: "ghes",
      accountModel: "managed",
      authentication: "saml",
      provisioning: "scim",
    })).toBe(false)
    expect(isProfileValid({
      ...defaultProfile,
      deployment: "residency",
      accountModel: "personal",
    })).toBe(false)
  })
})

describe("licensed product combinations", () => {
  const statuses: Exclude<LicenseStatus, "unknown">[] = ["unlicensed", "licensed"]
  const copilotPlans: Exclude<CopilotPlan, "unknown">[] = ["none", "business", "enterprise"]
  const productIds: LicensedProductId[] = ["secretProtection", "codeSecurity", "codeQuality"]

  it("matches hard product constraints across generated combinations", () => {
    for (const combination of identityCompatibilityMatrix) {
      for (const secretProtection of statuses) {
        for (const codeSecurity of statuses) {
          for (const codeQuality of statuses) {
            for (const copilot of copilotPlans) {
              const profile = profileFor(combination)
              profile.licensedProducts = {
                secretProtection,
                codeSecurity,
                codeQuality,
                copilot,
              }
              const expectedCodeQuality = codeQuality === "unlicensed"
                || profile.deployment === "dotcom"
              const expectedCopilot = copilot === "none"
                || (
                  profile.deployment !== "ghes"
                  && (copilot !== "enterprise" || profile.basePlan === "enterprise")
                )
              expect(
                isProfileValid(profile),
                JSON.stringify({ combination, profile: profile.licensedProducts }),
              ).toBe(expectedCodeQuality && expectedCopilot)
            }
          }
        }
      }
    }
  })

  it("requires migration-only unknown license values to be resolved", () => {
    for (const product of productIds) {
      const profile = {
        ...defaultProfile,
        licensedProducts: {
          ...defaultProfile.licensedProducts,
          [product]: "unknown",
        },
      } as Profile
      expect(isProfileValid(profile)).toBe(false)
    }
    expect(isProfileValid({
      ...defaultProfile,
      licensedProducts: { ...defaultProfile.licensedProducts, copilot: "unknown" },
    })).toBe(false)
  })
})

describe("capability resolution", () => {
  it("keeps base dependency capabilities without paid security products", () => {
    const capabilities = resolveProfile(defaultProfile).capabilities
    expect(capabilities.has("dependency-graph")).toBe(true)
    expect(capabilities.has("dependabot-alerts")).toBe(true)
    expect(capabilities.has("secret-protection")).toBe(false)
    expect(capabilities.has("code-security")).toBe(false)
  })

  it("makes GitHub.com public security available without a paid add-on", () => {
    const capabilities = resolveProfile({
      ...defaultProfile,
      repositoryVisibility: "public",
    }).capabilities
    expect(capabilities.has("public-repository-security")).toBe(true)
    expect(capabilities.has("secret-scanning")).toBe(true)
    expect(capabilities.has("code-scanning")).toBe(true)
  })

  it("resolves independent paid capabilities", () => {
    const capabilities = resolveProfile({
      ...defaultProfile,
      repositoryVisibility: "private-internal",
      licensedProducts: {
        secretProtection: "licensed",
        codeSecurity: "unlicensed",
        codeQuality: "licensed",
        copilot: "none",
      },
    }).capabilities
    expect(capabilities.has("secret-protection")).toBe(true)
    expect(capabilities.has("code-security")).toBe(false)
    expect(capabilities.has("code-quality")).toBe(true)
  })

  it("evaluates declarative all/any/none requirements", () => {
    const capabilities = resolveProfile(defaultProfile).capabilities
    expect(meetsCapabilityRequirement(capabilities, { allOf: ["actions", "dependency-graph"] })).toBe(true)
    expect(meetsCapabilityRequirement(capabilities, { anyOf: ["code-security", "dependabot-alerts"] })).toBe(true)
    expect(meetsCapabilityRequirement(capabilities, { noneOf: ["code-quality"] })).toBe(true)
    expect(meetsCapabilityRequirement(capabilities, { allOf: ["code-quality"] })).toBe(false)
  })
})
