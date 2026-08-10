import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { defaultIntent } from "../logic/intent"
import { Review } from "./Review"

describe("Review export choices", () => {
  it("distinguishes the human handoff from the machine-readable contract before download", () => {
    const html = renderToStaticMarkup(
      <Review
        currentState="greenfield"
        intent={defaultIntent}
        onDownloadJson={() => undefined}
        onDownloadMarkdown={() => undefined}
        onOpenDomain={() => undefined}
        reviewedCount={0}
        settings={[]}
      />,
    )

    expect(html).toContain("Review handoff")
    expect(html).toContain("Markdown · for people")
    expect(html).toContain("Download review handoff (.md)")
    expect(html).toContain("Desired-state contract")
    expect(html).toContain("JSON · for tools and re-entry")
    expect(html).toContain("Download desired-state contract (.json)")
    expect(html).toContain("Import it back here or adapt it downstream.")
    expect(html).toContain("neither validates or applies tenant settings")
  })
})
