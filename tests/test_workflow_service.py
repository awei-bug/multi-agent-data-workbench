import unittest

from backend_py.workflow_service import advance_workflow_with_model, apply_workflow_action, build_workflow_graph


class WorkflowServiceTest(unittest.TestCase):
    def test_builds_langgraph_workflow(self) -> None:
        graph = build_workflow_graph()

        self.assertTrue(hasattr(graph, "invoke"))
        graph_spec = graph.get_graph()
        for node_name in ["source", "clean", "metric", "chart", "analysis", "report", "audit"]:
            self.assertIn(node_name, graph_spec.nodes)

    def test_start_moves_first_node_to_running(self) -> None:
        task = {
            "status": "waiting",
            "snapshot": {
                "phase": "idle",
                "logMessage": "idle",
                "nodes": [
                    {"id": "source", "label": "Source Agent", "status": "pending"},
                    {"id": "clean", "label": "Clean Agent", "status": "pending"},
                ],
                "context": {
                    "activeAgent": "waiting",
                    "inputSummary": "input",
                    "outputSummary": "output",
                    "latestLog": "idle",
                    "risks": ["risk"],
                },
            },
            "risks": ["risk"],
        }

        updated = apply_workflow_action(task, "start")

        self.assertEqual(updated["snapshot"]["phase"], "running")
        self.assertEqual(updated["snapshot"]["nodes"][0]["status"], "running")
        self.assertEqual(updated["snapshot"]["context"]["activeAgent"], "Source Agent")
        self.assertEqual(updated["snapshot"]["context"]["latestLog"], "Source Agent running")
        self.assertIn("source", updated["snapshot"]["context"]["inputSummary"].lower())
        self.assertIn("source", updated["snapshot"]["context"]["outputSummary"].lower())
        self.assertEqual(updated["risks"], updated["snapshot"]["context"]["risks"])

    def test_analysis_step_uses_model_output(self) -> None:
        class FakeChatClient:
            async def complete(self, prompt: str) -> str:
                return "analysis summary from model"

        task = {
            "status": "running",
            "summary": "draft",
            "request": "analyze sales anomalies",
            "snapshot": {
                "phase": "running",
                "logMessage": "analysis pending",
                "nodes": [
                    {"id": "source", "label": "Source Agent", "status": "success"},
                    {"id": "clean", "label": "Clean Agent", "status": "success"},
                    {"id": "metric", "label": "Metric Agent", "status": "success"},
                    {"id": "chart", "label": "Chart Agent", "status": "success"},
                    {"id": "analysis", "label": "Analysis Agent", "status": "running"},
                    {"id": "report", "label": "Report Agent", "status": "pending"},
                    {"id": "audit", "label": "Audit Agent", "status": "pending"},
                ],
                "context": {
                    "activeAgent": "Analysis Agent",
                    "inputSummary": "analysis input",
                    "outputSummary": "analysis output",
                    "latestLog": "analysis pending",
                    "risks": [],
                },
            },
            "risks": [],
        }

        updated = advance_workflow_with_model(task, FakeChatClient())

        self.assertIn("analysis summary from model", updated["summary"])
        self.assertEqual(updated["snapshot"]["nodes"][4]["status"], "success")
        self.assertEqual(updated["snapshot"]["nodes"][5]["status"], "running")


if __name__ == "__main__":
    unittest.main()
