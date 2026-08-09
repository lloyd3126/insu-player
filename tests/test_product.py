from __future__ import annotations

import html
import json
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
    def test_repository_exposes_every_canonical_product_skill_bridge(self) -> None:
        canonical = {path.name for path in (PLUGIN_ROOT / "skills").iterdir() if path.is_dir()}
        bridges = {path.name for path in (REPO_ROOT / ".agents" / "skills").iterdir() if path.is_dir()}
        self.assertEqual(canonical, EXPECTED_SKILLS)
        self.assertTrue(EXPECTED_SKILLS.issubset(bridges))
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
        self.assertIn("使用說明、功能設定與影音中心", readme)
        self.assertIn("API SDK 與 API Key 設定狀態", readme)
        self.assertIn("## v0.2.0", changelog)
        self.assertIn("api.github.com/repos/lloyd3126/insu-player/releases/latest", manager)
        legacy_repository = "lloyd3126/" + "xe" + "ruca-player"
        self.assertNotIn(legacy_repository, readme + manager)

    def test_plugin_workspaces_stay_isolated_across_projects(self) -> None:
        watch_skill = (PLUGIN_ROOT / "skills" / "watch-video" / "SKILL.md").read_text(encoding="utf-8")
        library_skill = (PLUGIN_ROOT / "skills" / "video-library" / "SKILL.md").read_text(encoding="utf-8")
        workflow = (PLUGIN_ROOT / "skills" / "watch-video" / "references" / "workflow.md").read_text(encoding="utf-8")
        troubleshooting = (
            PLUGIN_ROOT / "skills" / "watch-video" / "references" / "troubleshooting.md"
        ).read_text(encoding="utf-8")

        self.assertIn("Treat the resolved workspace path as the library identity", watch_skill)
        self.assertIn("Never search outside the current project", watch_skill)
        self.assertIn("Never adopt another INSU workspace outside the current project", library_skill)
        self.assertIn("Port 衝突不會改變 workspace 身分", workflow)
        self.assertIn("不要因對方已有 runtime、jobs 或正在運作就跨專案沿用", troubleshooting)

    def test_watch_video_opens_the_homepage_before_setup_or_processing(self) -> None:
        watch_skill = (PLUGIN_ROOT / "skills" / "watch-video" / "SKILL.md").read_text(encoding="utf-8")
        workflow = (PLUGIN_ROOT / "skills" / "watch-video" / "references" / "workflow.md").read_text(encoding="utf-8")
        manifest = json.loads((PLUGIN_ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        plugin_agent = (PLUGIN_ROOT / "skills" / "watch-video" / "agents" / "openai.yaml").read_text(encoding="utf-8")
        bridge_agent = (REPO_ROOT / ".agents" / "skills" / "watch-video" / "agents" / "openai.yaml").read_text(encoding="utf-8")
        library_agent = (PLUGIN_ROOT / "skills" / "video-library" / "agents" / "openai.yaml").read_text(encoding="utf-8")
        library_bridge_agent = (
            REPO_ROOT / ".agents" / "skills" / "video-library" / "agents" / "openai.yaml"
        ).read_text(encoding="utf-8")
        start_here = (REPO_ROOT / "START-HERE.md").read_text(encoding="utf-8")

        self.assertIn("first user-visible product action opening", watch_skill)
        self.assertLess(
            watch_skill.index("first user-visible product action opening"),
            watch_skill.index("Run `scripts/portable/doctor.sh`"),
        )
        self.assertIn("## 階段 1：先開啟目前 Workspace 的首頁", workflow)
        self.assertLess(workflow.index("## 階段 1："), workflow.index("## 階段 3：從零盤點環境"))
        self.assertIn("Codex 內建瀏覽器", manifest["interface"]["defaultPrompt"])
        self.assertIn("First open this project's INSU Player homepage", plugin_agent)
        self.assertEqual(plugin_agent, bridge_agent)
        self.assertIn("First open this project's INSU Player homepage", library_agent)
        self.assertEqual(library_agent, library_bridge_agent)
        self.assertIn("第一個動作先啟動 INSU Player 首頁", start_here)

    def test_library_selects_and_records_an_available_port(self) -> None:
        watch_skill = (PLUGIN_ROOT / "skills" / "watch-video" / "SKILL.md").read_text(encoding="utf-8")
        library_skill = (PLUGIN_ROOT / "skills" / "video-library" / "SKILL.md").read_text(encoding="utf-8")
        workflow = (PLUGIN_ROOT / "skills" / "watch-video" / "references" / "workflow.md").read_text(encoding="utf-8")
        server = (REPO_ROOT / "src" / "server" / "bun.ts").read_text(encoding="utf-8")
        serve = (PLUGIN_ROOT / "skills" / "watch-video" / "scripts" / "serve-library.sh").read_text(encoding="utf-8")
        portable_serve = (REPO_ROOT / "scripts" / "portable" / "serve.sh").read_text(encoding="utf-8")

        self.assertIn(".insu-player-server.json", watch_skill + library_skill + workflow + server)
        self.assertIn("--auto-port", serve)
        self.assertIn('exec "$CAPTION_BUN" "$CAPTION_WEB_SERVER"', serve)
        self.assertIn("portIsAvailable", server)
        self.assertIn("server = startServer(selectedPort)", server)
        self.assertIn("const actualPort = server.port", server)
        self.assertIn('runtime: "hono-bun"', server)
        self.assertIn('if [ "$#" -eq 0 ]', portable_serve)
        self.assertNotIn("another port such as `8010`", watch_skill + library_skill)

    def test_translation_mode_uses_model_word_timing_and_sentence_aligned_pair_import(self) -> None:
        watch_skill = (PLUGIN_ROOT / "skills" / "watch-video" / "SKILL.md").read_text(encoding="utf-8")
        translate_skill = (PLUGIN_ROOT / "skills" / "translate-subtitles" / "SKILL.md").read_text(encoding="utf-8")
        transcriber = (PLUGIN_ROOT / "skills" / "transcribe-media" / "scripts" / "transcribe_media.py").read_text(encoding="utf-8")
        download = (PLUGIN_ROOT / "skills" / "watch-video" / "scripts" / "download-video.sh").read_text(encoding="utf-8")
        portable_add = (REPO_ROOT / "scripts" / "portable" / "add-video.sh").read_text(encoding="utf-8")
        reflow = PLUGIN_ROOT / "skills" / "translate-subtitles" / "scripts" / "reflow_subtitles.py"
        pair_import = PLUGIN_ROOT / "skills" / "watch-video" / "scripts" / "import-bilingual-captions.sh"

        self.assertIn("Before inspecting or downloading subtitles, ask", watch_skill)
        self.assertIn("must not inspect or download platform captions", translate_skill)
        self.assertIn("local or OpenAI", translate_skill)
        self.assertIn("skipping all source subtitles", download)
        self.assertNotIn("json3", download.lower())
        self.assertIn('"timestamp_granularities": ["segment", "word"]', transcriber)
        self.assertIn("--translate zh-TW or --no-translate", portable_add)
        self.assertIn("translation requires asking the user to choose --provider", portable_add)
        self.assertTrue(reflow.is_file())
        self.assertTrue(pair_import.is_file())
        self.assertIn("share one complete-sentence timeline", translate_skill)

    def test_static_page_titles_and_headings_do_not_use_punctuation(self) -> None:
        assets = [
            PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library" / "app" / "index.html",
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

    def test_react_library_and_player_keep_the_insu_product_contract(self) -> None:
        library_root = PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library"
        legacy_assets = [
            library_root / "index.html",
            library_root / "library.css",
            library_root / "library.js",
        ]
        built_home = library_root / "app" / "index.html"
        app_icon = library_root / "taiwan-whistling-thrush.png"
        player = (PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "player" / "index.html").read_text(encoding="utf-8")
        player_config = (PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "player" / "config.js").read_text(encoding="utf-8")
        react_app = (REPO_ROOT / "src" / "client" / "app" / "App.tsx").read_text(encoding="utf-8")
        overlays = (REPO_ROOT / "src" / "client" / "app" / "OverlayCoordinator.tsx").read_text(encoding="utf-8")
        library_component = (
            REPO_ROOT / "src" / "client" / "features" / "library" / "LibraryDialog.tsx"
        ).read_text(encoding="utf-8")
        usage_component = (
            REPO_ROOT / "src" / "client" / "features" / "home" / "UsageGuideDialog.tsx"
        ).read_text(encoding="utf-8")
        settings_component = (
            REPO_ROOT / "src" / "client" / "features" / "settings" / "FeatureSettingsDialog.tsx"
        ).read_text(encoding="utf-8")
        environment_component = (
            REPO_ROOT / "src" / "client" / "features" / "settings" / "EnvironmentDialog.tsx"
        ).read_text(encoding="utf-8")
        models_component = (
            REPO_ROOT / "src" / "client" / "features" / "resources" / "ModelsDialog.tsx"
        ).read_text(encoding="utf-8")
        detail_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "JobDetailDialog.tsx"
        ).read_text(encoding="utf-8")
        detail_about_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "JobAboutPanel.tsx"
        ).read_text(encoding="utf-8")
        detail_subtitle_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "JobSubtitlePanel.tsx"
        ).read_text(encoding="utf-8")
        detail_activity_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "JobActivityPanel.tsx"
        ).read_text(encoding="utf-8")
        detail_history_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "JobHistoryCard.tsx"
        ).read_text(encoding="utf-8")
        app_dialog = (
            REPO_ROOT / "src" / "client" / "components" / "shared" / "AppDialog.tsx"
        ).read_text(encoding="utf-8")
        server_app = (REPO_ROOT / "src" / "server" / "app.ts").read_text(encoding="utf-8")
        server_entry = (REPO_ROOT / "src" / "server" / "bun.ts").read_text(encoding="utf-8")
        serve_script = (
            PLUGIN_ROOT / "skills" / "watch-video" / "scripts" / "serve-library.sh"
        ).read_text(encoding="utf-8")
        python_server = (
            PLUGIN_ROOT / "skills" / "watch-video" / "scripts" / "library_server.py"
        ).read_text(encoding="utf-8")
        package = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))

        self.assertTrue(all(not path.exists() for path in legacy_assets))
        self.assertNotIn("legacyLibraryRoot", server_app + server_entry)
        self.assertNotIn("legacy-library-template", server_entry + serve_script)
        self.assertIn('path.join(options.libraryAppRoot, "assets")', server_app)
        self.assertIn('"assets" / "library" / "app"', python_server)
        self.assertTrue(built_home.is_file())
        self.assertIn('id="root"', built_home.read_text(encoding="utf-8"))
        self.assertTrue(app_icon.is_file())
        self.assertEqual(app_icon.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

        self.assertIn("讓影音跨越語言", react_app)
        self.assertIn("OverlayCoordinator", react_app)
        self.assertIn('className="hero-artwork"', react_app)
        self.assertIn('className="primary-nav"', react_app)
        self.assertIn("使用說明", react_app)
        self.assertIn("功能設定", react_app)
        self.assertIn("影音中心", react_app)
        self.assertNotIn("AppearanceDialog", overlays)
        self.assertIn("lazy(", overlays)

        self.assertIn('value="grid"', library_component)
        self.assertIn('value="list"', library_component)
        self.assertIn("我的影音", library_component)
        self.assertIn("詳細資訊", library_component)
        self.assertIn("CaptionLanguageSelect", library_component)
        self.assertIn("video-grid-card__duration", library_component)
        self.assertIn('className="job-table"', library_component)
        self.assertIn("搜尋影音", library_component)

        self.assertIn('value="getting-started"', usage_component)
        self.assertIn('value="my-prompts"', usage_component)
        self.assertIn('value="supported-sites"', usage_component)
        self.assertIn("開始使用", usage_component)
        self.assertIn("我的提示", usage_component)
        self.assertIn("支援網站", usage_component)

        self.assertIn('value="environment"', settings_component)
        self.assertIn('value="local-models"', settings_component)
        self.assertIn('value="cloud-models"', settings_component)
        self.assertIn("PromptActionCard", environment_component)
        self.assertIn("不要讀取 Key 原值", environment_component)
        self.assertIn("environment-table", environment_component)
        self.assertIn("PromptActionCard", models_component)
        self.assertIn("ApiKeySelect", models_component)
        self.assertIn("實際下載大小", models_component)

        self.assertIn('value="about"', detail_component)
        self.assertIn('value="subtitle"', detail_component)
        self.assertIn('value="segmentation"', detail_component)
        self.assertIn('value="activity"', detail_component)
        self.assertIn("JobHistoryCard", detail_about_component)
        self.assertIn("ScrollArea", detail_history_component)
        self.assertIn("useJobCaptions", detail_subtitle_component)
        self.assertIn("useJobLog", detail_activity_component)
        self.assertNotIn("狀態歷程", detail_activity_component)
        self.assertIn("Workflow log", detail_activity_component)

        tabbed_dialogs = usage_component + settings_component + library_component + detail_component
        self.assertEqual(tabbed_dialogs.count('layout="tabbed"'), 4)
        self.assertEqual(tabbed_dialogs.count("app-dialog-tabs"), 4)
        self.assertIn("app-dialog__body--tabbed", app_dialog)
        self.assertIn('app.get("/api/jobs"', server_app)
        self.assertIn('app.get("/api/models"', server_app)
        self.assertIn('app.get("/api/environment"', server_app)
        self.assertIn("react", package["dependencies"])
        self.assertIn("hono", package["dependencies"])
        self.assertIn("drizzle-orm", package["dependencies"])

        self.assertIn("INSU Player", player)
        self.assertIn("window.INSU_PLAYER_CONFIG", player)
        self.assertIn("INSU_PLAYER_CONFIG", player_config)
        for opening in re.findall(r"<svg\b[^>]*>", player):
            self.assertIn('class="lucide ', opening)

        visible_sources = [
            PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "player" / "index.html",
            PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "player" / "config.js",
            *sorted((PLUGIN_ROOT / "skills" / "watch-video" / "scripts").glob("*")),
            *sorted((REPO_ROOT / "src" / "client").rglob("*.tsx")),
        ]
        for source in visible_sources:
            if source.is_file():
                self.assertNotIn("；", source.read_text(encoding="utf-8"), source)


if __name__ == "__main__":
    unittest.main()
