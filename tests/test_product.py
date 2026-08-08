from __future__ import annotations

import json
import html
import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = REPO_ROOT / "plugins" / "insu-player"
EXPECTED_SKILLS = {
    "watch-video",
    "video-library",
    "transcribe-media",
    "translate-subtitles",
    "player-manager",
}


class ProductBoundaryTests(unittest.TestCase):
    def test_plugin_and_repository_bridges_expose_the_same_five_skills(self) -> None:
        canonical = {path.name for path in (PLUGIN_ROOT / "skills").iterdir() if path.is_dir()}
        bridges = {path.name for path in (REPO_ROOT / ".agents" / "skills").iterdir() if path.is_dir()}
        self.assertEqual(canonical, EXPECTED_SKILLS)
        self.assertEqual(bridges, EXPECTED_SKILLS)
        for name in EXPECTED_SKILLS:
            bridge = (REPO_ROOT / ".agents" / "skills" / name / "SKILL.md").read_text(encoding="utf-8")
            self.assertIn(f"plugins/insu-player/skills/{name}/SKILL.md", bridge)

    def test_version_and_plugin_manifest_agree(self) -> None:
        version = (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        manifest = json.loads((PLUGIN_ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(version, manifest["version"])
        self.assertEqual(manifest["name"], "insu-player")
        self.assertEqual(manifest["interface"]["displayName"], "INSU Player")
        self.assertEqual(manifest["interface"]["brandColor"], "#8B7CF6")
        self.assertTrue((PLUGIN_ROOT / manifest["interface"]["logo"]).is_file())
        self.assertIn("用 Agent", manifest["interface"]["shortDescription"])
        self.assertIn("$watch-video", manifest["interface"]["defaultPrompt"])

    def test_product_docs_use_the_insu_repository_and_brand(self) -> None:
        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        changelog = (REPO_ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        manager = (PLUGIN_ROOT / "skills" / "player-manager" / "scripts" / "manage.py").read_text(encoding="utf-8")
        self.assertIn("# INSU Player", readme)
        self.assertIn("https://github.com/lloyd3126/insu-player.git", readme)
        self.assertIn("環境變數、模型列表與影片列表", readme)
        self.assertIn("API SDK 與 API Key 設定狀態", readme)
        self.assertIn("## v0.2.0", changelog)
        self.assertIn("api.github.com/repos/lloyd3126/insu-player/releases/latest", manager)
        legacy_repository = "lloyd3126/" + "xe" + "ruca-player"
        self.assertNotIn(legacy_repository, readme + manager)

    def test_static_page_titles_and_headings_do_not_use_punctuation(self) -> None:
        assets = [
            PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library" / "index.html",
            PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "player" / "index.html",
        ]
        forbidden = set("，。！？、；：·,.;:!?")
        pattern = re.compile(r"<(title|h[1-6])\b[^>]*>(.*?)</\1>", re.IGNORECASE | re.DOTALL)
        for source in assets:
            markup = source.read_text(encoding="utf-8")
            for _, raw_text in pattern.findall(markup):
                title = html.unescape(re.sub(r"<[^>]+>", "", raw_text)).strip()
                used = sorted(forbidden.intersection(title))
                self.assertFalse(used, f"{source}: title uses punctuation {used}: {title}")

    def test_library_and_player_assets_keep_the_insu_product_contract(self) -> None:
        library = (PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library" / "index.html").read_text(encoding="utf-8")
        library_script = (PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library" / "library.js").read_text(encoding="utf-8")
        styles = (PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library" / "library.css").read_text(encoding="utf-8")
        server = (PLUGIN_ROOT / "skills" / "watch-video" / "scripts" / "library_server.py").read_text(encoding="utf-8")
        player = (PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "player" / "index.html").read_text(encoding="utf-8")
        app_icon = PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library" / "taiwan-whistling-thrush.png"
        self.assertIn("INSU PLAYER", library)
        self.assertIn("交給 Agent", library)
        self.assertTrue(app_icon.is_file())
        self.assertEqual(app_icon.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
        self.assertIn('id="player-dialog"', library)
        self.assertIn('id="player-frame"', library)
        self.assertIn('id="open-supported-sites"', library)
        self.assertIn('id="supported-sites-dialog"', library)
        self.assertIn('id="open-models"', library)
        self.assertIn('id="models-dialog"', library)
        self.assertIn("模型列表", library)
        self.assertIn('id="local-model-rows"', library)
        self.assertIn('id="api-model-rows"', library)
        self.assertIn("實際下載大小", library)
        self.assertIn("API Key", library)
        self.assertNotIn("本機下載", library)
        self.assertIn('api.keyConfigured ? "已設定" : "尚未設定"', library_script)
        self.assertIn('"keyConfigured": bool(os.environ.get("OPENAI_API_KEY"))', server)
        self.assertIn('fetch("/api/models"', library_script)
        self.assertIn('path == "/api/models"', server)
        self.assertIn('"name": "whisper-1"', server)
        self.assertNotIn("model-grid", library + styles)
        self.assertNotIn("api-model-card", library + styles)
        self.assertNotIn("CHOOSE WITH THE AGENT", library)
        self.assertNotIn("沒有字幕時再選擇轉錄模型", library)
        self.assertNotIn("models-intro", library + styles)
        nav_labels = ["開始使用", "進階使用", "支援網站", "介面設定", "環境變數", "模型列表", "影片列表"]
        nav = library[library.index('<nav class="primary-nav"'):library.index("</nav>")]
        self.assertEqual([nav.index(label) for label in nav_labels], sorted(nav.index(label) for label in nav_labels))
        self.assertNotIn("使用規範", nav)
        self.assertIn('id="open-usage-example"', library)
        self.assertIn('id="open-usage-example-nav"', library)
        self.assertIn('id="usage-example-dialog"', library)
        self.assertIn('id="open-advanced-usage"', library)
        self.assertIn('id="advanced-usage-dialog"', library)
        self.assertIn('id="my-prompts-list"', library)
        self.assertIn('id="open-settings"', library)
        self.assertIn('id="settings-dialog"', library)
        self.assertIn("介面設定", library)
        self.assertIn('id="open-environment"', library)
        self.assertIn('id="environment-dialog"', library)
        self.assertIn('id="environment-form"', library)
        self.assertIn("環境變數", library)
        self.assertIn('fetch("/api/environment"', library_script)
        self.assertIn("elements.environmentDialog.open", library_script)
        self.assertIn("只在本次服務中使用", library)
        self.assertNotIn(".env", library)
        self.assertIn("影片列表", library)
        self.assertIn('id="font-preset"', library)
        self.assertIn('id="local-font-input"', library)
        self.assertIn("臺灣紫嘯鶇", library)
        self.assertIn(".example-dialog, .advanced-dialog, .models-dialog, .settings-dialog, .environment-dialog, .library-dialog, .player-dialog, .detail-dialog, .sources-dialog", styles)
        self.assertIn(".example-content { display: grid; grid-template-columns: 1fr;", styles)
        self.assertNotIn("grid-template-columns: minmax(280px, .82fr) minmax(430px, 1.18fr)", styles)
        self.assertIn(".policy-dialog { width: min(720px, calc(100% - 42px)); }", styles)
        self.assertIn(".example-dialog, .advanced-dialog, .models-dialog, .settings-dialog, .environment-dialog, .library-dialog, .player-dialog, .detail-dialog, .sources-dialog, .policy-dialog", styles)
        self.assertIn(">開始使用</button>", library)
        self.assertIn("把想看的影片網址交給 Agent，Agent 會準備好影片與字幕後，放進 INSU 讓你觀看。", library)
        self.assertNotIn("點擊開始", library)
        self.assertNotIn("<span>ESC</span>", library)
        self.assertNotIn("USE THE AGENT AS THE INTERFACE", library)
        self.assertNotIn("advanced-intro", library)
        self.assertNotIn("說出想完成的事", library)
        self.assertNotIn("font-style: italic", styles)
        self.assertNotIn("<em", library)
        self.assertNotIn("Codex", library)
        self.assertIn('id="open-library"', library)
        self.assertIn('id="library-dialog"', library)
        self.assertIn('class="landing"', library)
        self.assertIn('id="usage-policy-dialog"', library)
        self.assertIn('id="open-usage-policy"', library)
        footer = library[library.index('<footer class="landing-footer">'):library.index("</footer>")]
        self.assertIn('id="open-usage-policy"', footer)
        self.assertIn('© <span id="footer-year"></span> INSU', footer)
        self.assertNotIn("ASK THE AGENT · WATCH IN INSU", footer)
        self.assertNotIn("© 2026 INSU", footer)
        self.assertIn("new Date().getFullYear()", library_script)
        self.assertIn("USER AGREEMENT", library)
        self.assertNotIn("USER AGREEMENT · V2", library)
        self.assertIn("服務與免責", library)
        self.assertIn("依「現狀」與「可用狀態」提供", library)
        self.assertIn("研究還沒支援的平台", library)
        self.assertIn("https://www.youtube.com/watch?v=VIDEO_ID", library)
        self.assertNotIn("有權處理的", library)
        self.assertNotIn('id="server-time"', library)
        self.assertIn("--claw: #8b7cf6", styles)
        self.assertNotIn("#ff6542", styles)
        self.assertNotIn("255 101 66", styles)
        self.assertNotIn("1240px", styles)
        self.assertNotIn("width: min(900px", styles)
        self.assertNotIn("width: min(820px", styles)
        self.assertNotIn("#57d7bf", styles)
        self.assertNotIn("87 215 191", styles)
        self.assertIn("INSU Player", player)
        self.assertIn("window.INSU_PLAYER_CONFIG", player)
        self.assertNotIn("my-agent-playbook", library + styles + player)
        legacy_product = "xe" + "ruca player"
        self.assertNotIn(legacy_product, (library + player).lower())
        visible_sources = [
            PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library" / "index.html",
            PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library" / "library.js",
            PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "player" / "index.html",
            PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "player" / "config.js",
            *sorted((PLUGIN_ROOT / "skills" / "watch-video" / "scripts").glob("*")),
        ]
        for source in visible_sources:
            if source.is_file() and source.suffix in {".html", ".js", ".py", ".sh"}:
                self.assertNotIn("；", source.read_text(encoding="utf-8"), source)


if __name__ == "__main__":
    unittest.main()
