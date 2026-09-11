import type { Findings, RunContext } from "./scan.ts"

interface MarkdownText {
  readonly type: "mrkdwn"
  readonly text: string
}

interface Block {
  readonly type: "section" | "context"
  readonly text?: MarkdownText
  readonly elements?: readonly MarkdownText[]
}

export interface SlackPayload {
  /** Shown in notifications and by clients that cannot render blocks. */
  readonly text: string
  readonly blocks: readonly Block[]
}

const SHORT_SHA_LENGTH = 7

const mrkdwn = (text: string): MarkdownText => ({ type: "mrkdwn", text })

export function buildSlackPayload(
  repository: string,
  commitSha: string,
  findings: Findings,
  context: RunContext,
): SlackPayload {
  const shortSha = commitSha.slice(0, SHORT_SHA_LENGTH)
  const commitUrl = `${context.serverUrl}/${context.repositoryFullName}/commit/${commitSha}`
  const runUrl = `${context.serverUrl}/${context.repositoryFullName}/actions/runs/${context.runId}`

  return {
    text: `Aikido scan on ${repository} (${shortSha}) found ${findings.issues} issues: ${findings.diffUrl}`,
    blocks: [
      {
        type: "section",
        text: mrkdwn(
          `:shield: Aikido scan found *${findings.issues}* issues on *${repository}* — <${findings.diffUrl}|View in Aikido>`,
        ),
      },
      {
        type: "context",
        elements: [
          mrkdwn(
            `branch \`${context.branch}\` · <${commitUrl}|${shortSha}> · by ${context.actor} · <${runUrl}|Workflow run>`,
          ),
        ],
      },
    ],
  }
}
