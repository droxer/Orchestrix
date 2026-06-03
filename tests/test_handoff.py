import json
import os
import unittest
from unittest.mock import patch

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
                    "pi_failures": 0,
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
                    "pi_failures": 0,
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
                    "pi_failures": 0,
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
                "pi_failures": 0,
                "codex_failures": 0,
                "codex_verdict": "rejected",
                "codex_feedback": "Token expiry is not checked.",
            }
        )

        self.assertIn("Fix auth", prompt)
        self.assertIn("Token expiry is not checked.", prompt)


class PiHandoffTest(unittest.TestCase):
    def test_claude_success_routes_to_pi(self):
        self.assertEqual(
            orchestrator.route_claude_handoff(
                {
                    "task_goal": "task",
                    "agent_logs": [],
                    "last_exit_code": 0,
                    "claude_failures": 0,
                    "pi_failures": 0,
                    "codex_failures": 0,
                    "codex_verdict": "",
                    "codex_feedback": "",
                }
            ),
            "pi_implement",
        )

    def test_pi_success_routes_to_codex_review(self):
        self.assertEqual(
            orchestrator.route_pi_handoff(
                {
                    "task_goal": "task",
                    "agent_logs": [],
                    "last_exit_code": 0,
                    "claude_failures": 0,
                    "pi_failures": 0,
                    "codex_failures": 0,
                    "codex_verdict": "",
                    "codex_feedback": "",
                }
            ),
            "codex_review",
        )

    def test_pi_failure_retries_pi(self):
        self.assertEqual(
            orchestrator.route_pi_handoff(
                {
                    "task_goal": "task",
                    "agent_logs": [],
                    "last_exit_code": 1,
                    "claude_failures": 0,
                    "pi_failures": 1,
                    "codex_failures": 0,
                    "codex_verdict": "",
                    "codex_feedback": "",
                }
            ),
            "pi_implement",
        )


class PiPromptTest(unittest.TestCase):
    def test_pi_prompt_includes_codex_feedback(self):
        prompt = orchestrator.pi_task_prompt(
            {
                "task_goal": "Fix auth",
                "agent_logs": [],
                "last_exit_code": 0,
                "claude_failures": 0,
                "pi_failures": 0,
                "codex_failures": 0,
                "codex_verdict": "rejected",
                "codex_feedback": "Token expiry is not checked.",
            }
        )

        self.assertIn("Fix auth", prompt)
        self.assertIn("current implementation", prompt)
        self.assertIn("Token expiry is not checked.", prompt)


class PiConfigTest(unittest.TestCase):
    def test_openai_compatible_env_generates_pi_provider_config(self):
        env = {
            "OPENAI_API_KEY": "test-key",
            "OPENAI_BASE_URL": "https://api.example.com/v1",
            "OPENAI_MODEL": "test-model",
        }
        with patch.dict(os.environ, env, clear=True):
            auth = json.loads(orchestrator.guest_pi_auth_json())
            models = json.loads(orchestrator.guest_pi_models_json())
            command = orchestrator.build_pi_implement_command(
                {
                    "task_goal": "task",
                    "agent_logs": [],
                    "last_exit_code": 0,
                    "claude_failures": 0,
                    "pi_failures": 0,
                    "codex_failures": 0,
                    "codex_verdict": "",
                    "codex_feedback": "",
                }
            )
            preflight = orchestrator.build_pi_preflight_command()

        self.assertIn("openai", auth)
        provider = models["providers"]["openai"]
        self.assertEqual(provider["baseUrl"], "https://api.example.com/v1")
        self.assertEqual(provider["apiKey"], "$PI_API_KEY")
        self.assertEqual(provider["api"], "openai-completions")
        self.assertIs(provider["authHeader"], True)
        self.assertEqual(provider["compat"]["maxTokensField"], "max_tokens")
        self.assertIs(provider["compat"]["supportsDeveloperRole"], False)
        self.assertIs(provider["compat"]["supportsStore"], False)
        self.assertEqual(provider["models"][0]["id"], "test-model")
        self.assertIn("PI_CODING_AGENT_DIR=/home/agent/.pi/agent", command)
        self.assertIn("--provider openai", command)
        self.assertIn("--model test-model", command)
        self.assertIn("pi --list-models", preflight)
        self.assertIn("openai test-model", preflight)

    def test_minimax_openai_env_uses_pi_native_provider(self):
        env = {
            "OPENAI_API_KEY": "test-key",
            "OPENAI_BASE_URL": "https://api.minimaxi.com/v1",
            "OPENAI_MODEL": "MiniMax-M2.7",
        }
        with patch.dict(os.environ, env, clear=True):
            auth = json.loads(orchestrator.guest_pi_auth_json())
            models = json.loads(orchestrator.guest_pi_models_json())
            command = orchestrator.build_pi_implement_command(
                {
                    "task_goal": "task",
                    "agent_logs": [],
                    "last_exit_code": 0,
                    "claude_failures": 0,
                    "pi_failures": 0,
                    "codex_failures": 0,
                    "codex_verdict": "",
                    "codex_feedback": "",
                }
            )
            preflight = orchestrator.build_pi_preflight_command()

        self.assertEqual(auth["minimax-cn"]["key"], "test-key")
        self.assertEqual(models, {"providers": {}})
        self.assertIn("--provider minimax-cn", command)
        self.assertIn("--model MiniMax-M2.7", command)
        self.assertIn("pi --list-models", preflight)
        self.assertIn("minimax-cn MiniMax-M2.7", preflight)

    def test_pi_env_overrides_openai_env(self):
        env = {
            "OPENAI_API_KEY": "openai-key",
            "OPENAI_BASE_URL": "https://api.openai-compatible.com/v1",
            "OPENAI_MODEL": "openai-model",
            "PI_API_KEY": "pi-key",
            "PI_BASE_URL": "https://pi.example.com/v1",
            "PI_MODEL": "pi-model",
        }
        with patch.dict(os.environ, env, clear=True):
            auth = json.loads(orchestrator.guest_pi_auth_json())
            provider = json.loads(orchestrator.guest_pi_models_json())["providers"]["openai"]

        self.assertEqual(auth["openai"]["key"], "pi-key")
        self.assertEqual(provider["baseUrl"], "https://pi.example.com/v1")
        self.assertEqual(provider["models"][0]["id"], "pi-model")

    def test_anthropic_compatible_pi_provider_config(self):
        env = {
            "PI_API_KEY": "pi-key",
            "PI_BASE_URL": "https://api.example.com/anthropic",
            "PI_MODEL": "claude-compatible",
            "PI_PROVIDER": "anthropic",
        }
        with patch.dict(os.environ, env, clear=True):
            auth = json.loads(orchestrator.guest_pi_auth_json())
            provider = json.loads(orchestrator.guest_pi_models_json())["providers"][
                "anthropic"
            ]
            command = orchestrator.build_pi_implement_command(
                {
                    "task_goal": "task",
                    "agent_logs": [],
                    "last_exit_code": 0,
                    "claude_failures": 0,
                    "pi_failures": 0,
                    "codex_failures": 0,
                    "codex_verdict": "",
                    "codex_feedback": "",
                }
            )

        self.assertEqual(auth["anthropic"]["key"], "pi-key")
        self.assertEqual(provider["api"], "anthropic-messages")
        self.assertEqual(provider["baseUrl"], "https://api.example.com/anthropic")
        self.assertNotIn("authHeader", provider)
        self.assertIn("--provider anthropic", command)
        self.assertIn("--model claude-compatible", command)

    def test_guest_env_exports_derived_pi_api_key(self):
        env = {
            "OPENAI_API_KEY": "openai-key",
            "OPENAI_BASE_URL": "https://api.example.com/v1",
            "OPENAI_MODEL": "test-model",
        }
        with patch.dict(os.environ, env, clear=True):
            guest_env = orchestrator.guest_agent_env()

        self.assertIn(("PI_API_KEY", "openai-key"), guest_env)


if __name__ == "__main__":
    unittest.main()
