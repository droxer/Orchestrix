import json
import unittest

from orchestrix import orchestrator


def codex_stdout(message: str) -> str:
    return json.dumps(
        {
            "type": "item.completed",
            "item": {
                "type": "agent_message",
                "text": message,
            },
        }
    )


class CodexReviewParsingTest(unittest.TestCase):
    def test_rejected_verdict_with_zero_exit_routes_to_claude(self):
        feedback = orchestrator.extract_codex_feedback(
            codex_stdout(
                "Blocking issue found.\nORCHESTRIX_REVIEW_VERDICT: REJECTED"
            )
        )

        self.assertEqual(orchestrator.classify_codex_review(0, feedback), "rejected")
        self.assertEqual(
            orchestrator.route_codex_handoff(
                {
                    "task_goal": "task",
                    "agent_logs": [],
                    "last_exit_code": 0,
                    "claude_failures": 0,
                    "codex_failures": 0,
                    "codex_verdict": "rejected",
                    "codex_feedback": feedback,
                }
            ),
            "claude_implement",
        )

    def test_approved_verdict_routes_to_end(self):
        feedback = orchestrator.extract_codex_feedback(
            codex_stdout("Looks good.\nORCHESTRIX_REVIEW_VERDICT: APPROVED")
        )

        self.assertEqual(orchestrator.classify_codex_review(0, feedback), "approved")
        self.assertEqual(
            orchestrator.route_codex_handoff(
                {
                    "task_goal": "task",
                    "agent_logs": [],
                    "last_exit_code": 0,
                    "claude_failures": 0,
                    "codex_failures": 0,
                    "codex_verdict": "approved",
                    "codex_feedback": feedback,
                }
            ),
            "__end__",
        )

    def test_codex_runtime_failure_retries_review_not_claude(self):
        self.assertEqual(orchestrator.classify_codex_review(1, "auth failed"), "failed")
        self.assertEqual(
            orchestrator.route_codex_handoff(
                {
                    "task_goal": "task",
                    "agent_logs": [],
                    "last_exit_code": 1,
                    "claude_failures": 0,
                    "codex_failures": 1,
                    "codex_verdict": "failed",
                    "codex_feedback": "auth failed",
                }
            ),
            "codex_review",
        )


class ClaudePromptTest(unittest.TestCase):
    def test_claude_prompt_includes_codex_feedback(self):
        prompt = orchestrator.claude_task_prompt(
            {
                "task_goal": "Fix auth",
                "agent_logs": [],
                "last_exit_code": 0,
                "claude_failures": 0,
                "codex_failures": 0,
                "codex_verdict": "rejected",
                "codex_feedback": "Token expiry is not checked.",
            }
        )

        self.assertIn("Fix auth", prompt)
        self.assertIn("Token expiry is not checked.", prompt)


if __name__ == "__main__":
    unittest.main()
