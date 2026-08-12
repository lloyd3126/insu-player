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
    "monitor-player-job",
    "video-library",
    "transcribe-media",
    "translate-subtitles",
    "proofread-subtitles",
    "segment-subtitles",
    "summarize-video",
    "map-video-summary",
    "migrate-player-library",
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
        prompts = manifest["interface"]["defaultPrompt"]
        self.assertIsInstance(prompts, list)
        self.assertEqual(len(prompts), 1)
        self.assertLessEqual(len(prompts[0]), 128)
        self.assertIn("$watch-video", prompts[0])
        self.assertIn("雲端 STT SDK", prompts[0])
        self.assertIn("SQLite", prompts[0])
        self.assertIn("Whisper medium", prompts[0])
        self.assertIn("完成後停在首頁", prompts[0])
        self.assertIn("開始說明 → 加入影音", prompts[0])
        self.assertIn("不要直接詢問網址或技術選項", prompts[0])
        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("選擇「試用」", readme)
        self.assertIn(f"```text\n{prompts[0]}\n```", readme)

    def test_web_and_prompt_sources_do_not_use_full_width_semicolons(self) -> None:
        files = [
            REPO_ROOT / "README.md",
            REPO_ROOT / "AGENTS.md",
            REPO_ROOT / "START-HERE.md",
            PLUGIN_ROOT / ".codex-plugin" / "plugin.json",
            *sorted((REPO_ROOT / "src" / "client").rglob("*.ts")),
            *sorted((REPO_ROOT / "src" / "client").rglob("*.tsx")),
            *sorted((REPO_ROOT / "src" / "client").rglob("*.css")),
            *sorted((REPO_ROOT / "src" / "shared" / "prompts").glob("*.ts")),
            *sorted((PLUGIN_ROOT / "skills").rglob("SKILL.md")),
            *sorted((PLUGIN_ROOT / "skills").rglob("openai.yaml")),
            *sorted((PLUGIN_ROOT / "skills").rglob("*.md")),
            *sorted((PLUGIN_ROOT / "chrome-extension").glob("*.html")),
            *sorted((PLUGIN_ROOT / "chrome-extension").glob("*.js")),
            *sorted((PLUGIN_ROOT / "chrome-extension").glob("*.css")),
            *sorted((PLUGIN_ROOT / "chrome-extension").glob("*.md")),
        ]
        for source in files:
            self.assertNotIn("\uff1b", source.read_text(encoding="utf-8"), source)

    def test_chrome_extension_has_a_narrow_packaged_bootstrap_contract(self) -> None:
        extension = PLUGIN_ROOT / "chrome-extension"
        manifest = json.loads((extension / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["manifest_version"], 3)
        self.assertEqual(manifest["background"]["service_worker"], "service-worker.js")
        self.assertEqual(
            manifest["host_permissions"],
            ["http://127.0.0.1/*", "http://localhost/*"],
        )
        self.assertEqual(manifest["optional_permissions"], ["cookies"])
        self.assertEqual(
            manifest["optional_host_permissions"],
            ["http://*/*", "https://*/*"],
        )
        for filename in [
            "service-worker.js",
            "content-bridge.js",
            "media-discovery.js",
            "popup.html",
            "popup.js",
            "popup.css",
            "connection-protocol.js",
            "README.md",
        ]:
            self.assertTrue((extension / filename).is_file(), filename)
        service_worker = (extension / "service-worker.js").read_text(encoding="utf-8")
        popup = (extension / "popup.js").read_text(encoding="utf-8")
        popup_html = (extension / "popup.html").read_text(encoding="utf-8")
        content_bridge = (extension / "content-bridge.js").read_text(encoding="utf-8")
        self.assertIn("chrome.storage.session", service_worker)
        self.assertIn("chrome.webRequest", service_worker)
        self.assertIn("pairing-bootstrap.json", service_worker)
        self.assertIn('case "RETRY_CONNECTION"', service_worker)
        self.assertNotIn('case "IMPORT_PAIRING_FILE"', service_worker)
        self.assertNotIn("CONNECT_CURRENT_INSU", service_worker)
        self.assertNotIn("REQUEST_INSU_CONNECTION", content_bridge)
        self.assertNotIn(".insu-pairing", popup_html)
        self.assertNotIn('type="file"', popup_html)
        self.assertNotIn("file.text()", popup)
        self.assertIn("authenticationConsentAt", popup)
        self.assertIn("cookiePermissionOrigins(candidates)", popup)
        self.assertIn("candidates,", popup)
        self.assertNotIn('name="candidate"', popup)
        self.assertNotIn('id="candidate-list"', popup_html)
        self.assertNotIn('id="rights"', popup_html)
        self.assertNotIn("rightsInput", popup)
        self.assertNotIn("sourceLocation", popup)
        self.assertIn(
            "點擊以下按鈕代表有權下載、轉錄與觀看這項內容，且同意把這組來源需要的 Cookie 傳到本機服務，只供這次下載使用。",
            popup_html,
        )
        self.assertNotIn("advanced-scan", popup_html)
        self.assertNotIn("releaseOptionalPermissions", popup)
        self.assertIn("performance.getEntriesByType", popup)
        self.assertNotIn("chrome.cookies.getAll(store ?", popup)
        self.assertIn("rightsConfirmed: true", popup)

    def test_product_docs_use_the_insu_repository_and_brand(self) -> None:
        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        agent_guide = (REPO_ROOT / "AGENTS.md").read_text(encoding="utf-8")
        changelog = (REPO_ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        manager = (PLUGIN_ROOT / "skills" / "player-manager" / "scripts" / "manage.py").read_text(encoding="utf-8")
        self.assertIn("# INSU Player", readme)
        self.assertIn("https://github.com/lloyd3126/insu-player.git", readme)
        self.assertIn(
            "開始說明、我的提示、轉錄設定、支援網站、擴充功能與影片中心",
            readme,
        )
        self.assertIn("統一模型目錄", readme)
        self.assertIn("bun-runtime/bin` 加入 `PATH`", agent_guide)
        self.assertIn("不得假設使用者已安裝全域 Bun", agent_guide)
        self.assertIn("$monitor-player-job", agent_guide)
        self.assertIn("所有 skill validator", agent_guide)
        self.assertIn("## 十一個產品 skills", readme)
        self.assertIn("使用 $migrate-player-library 更新目前專案既有的 INSU Player 資料", readme)
        self.assertIn("確認遷移 DIGEST", readme)
        package = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        manifest = json.loads((PLUGIN_ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], manifest["version"])
        self.assertEqual(manifest["version"], "0.3.0")
        self.assertIn("## v0.3.0", changelog)
        self.assertIn("codex plugin marketplace upgrade insu-player", readme)
        self.assertIn("完成後開啟新的 Codex task", readme)
        self.assertIn("portable releases are immutable", manager)
        self.assertNotIn("api.github.com/repos/lloyd3126/insu-player/releases/latest", manager)
        legacy_repository = "lloyd3126/" + "xe" + "ruca-player"
        self.assertNotIn(legacy_repository, readme + manager)

    def test_long_running_jobs_use_one_current_task_heartbeat(self) -> None:
        watch_skill = (PLUGIN_ROOT / "skills" / "watch-video" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        monitor_root = PLUGIN_ROOT / "skills" / "monitor-player-job"
        monitor_skill = (monitor_root / "SKILL.md").read_text(encoding="utf-8")
        contract = (monitor_root / "references" / "monitoring-contract.md").read_text(
            encoding="utf-8"
        )
        plugin_agent = (monitor_root / "agents" / "openai.yaml").read_text(encoding="utf-8")
        bridge_agent = (
            REPO_ROOT / ".agents" / "skills" / "monitor-player-job" / "agents" / "openai.yaml"
        ).read_text(encoding="utf-8")
        manifest = json.loads((PLUGIN_ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))

        self.assertIn("$monitor-player-job", watch_skill)
        self.assertIn("five-minute heartbeat attached to the current task", watch_skill)
        self.assertIn("Never create a standalone scheduled task", monitor_skill)
        self.assertIn("never an isolated worktree", monitor_skill)
        self.assertIn("do not migrate, coerce, or fall back", monitor_skill)
        self.assertIn("SQLite operation records remain the source of truth", contract)
        self.assertIn("or application database rows", contract)
        self.assertIn("Do not emulate it with `sleep`", contract)
        self.assertEqual(plugin_agent, bridge_agent)
        self.assertIn("$monitor-player-job", plugin_agent)
        self.assertIn("長時間工作排程追蹤與同 task 復原", manifest["interface"]["capabilities"])

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
        self.assertIn("先開啟專案首頁", manifest["interface"]["defaultPrompt"][0])
        self.assertIn("完成後停在首頁", manifest["interface"]["defaultPrompt"][0])
        self.assertIn("Open this project's", plugin_agent)
        self.assertIn("INSU Player homepage", plugin_agent)
        self.assertEqual(plugin_agent, bridge_agent)
        self.assertIn("First open this project's INSU Player homepage", library_agent)
        self.assertEqual(library_agent, library_bridge_agent)
        self.assertIn("完成後停在首頁", start_here)
        self.assertIn("不要直接詢問網址或技術選項", start_here)

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
        self.assertIn(
            "unset OPENAI_API_KEY GROQ_API_KEY ELEVENLABS_API_KEY XAI_API_KEY OPENROUTER_API_KEY",
            serve,
        )
        self.assertIn("portIsAvailable", server)
        self.assertIn("server = startServer(selectedPort)", server)
        self.assertIn("const actualPort = server.port", server)
        self.assertIn('runtime: "hono-bun"', server)
        self.assertIn('if [ "$#" -eq 0 ]', portable_serve)
        self.assertNotIn("another port such as `8010`", watch_skill + library_skill)

    def test_translation_and_segmentation_use_multilingual_timed_units_and_pair_import(self) -> None:
        watch_skill = (PLUGIN_ROOT / "skills" / "watch-video" / "SKILL.md").read_text(encoding="utf-8")
        translate_skill = (PLUGIN_ROOT / "skills" / "translate-subtitles" / "SKILL.md").read_text(encoding="utf-8")
        segment_skill = (PLUGIN_ROOT / "skills" / "segment-subtitles" / "SKILL.md").read_text(encoding="utf-8")
        transcriber = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted(
                (PLUGIN_ROOT / "skills" / "transcribe-media" / "scripts").rglob("*.py")
            )
        )
        download = (PLUGIN_ROOT / "skills" / "watch-video" / "scripts" / "download-video.sh").read_text(encoding="utf-8")
        portable_add = (REPO_ROOT / "scripts" / "portable" / "add-video.sh").read_text(encoding="utf-8")
        reflow = PLUGIN_ROOT / "skills" / "translate-subtitles" / "scripts" / "reflow_subtitles.py"
        segmentation = PLUGIN_ROOT / "skills" / "segment-subtitles" / "scripts" / "segment_subtitles.py"
        revision_import = PLUGIN_ROOT / "skills" / "watch-video" / "scripts" / "import-subtitle-revision.sh"
        processor_contract = (
            REPO_ROOT / "src" / "shared" / "contracts" / "processor.ts"
        ).read_text(encoding="utf-8")
        job_contract = (
            REPO_ROOT / "src" / "shared" / "contracts" / "job.ts"
        ).read_text(encoding="utf-8")
        artifact_contract = (
            REPO_ROOT / "src" / "shared" / "contracts" / "subtitle-catalog.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("Before inspecting or downloading subtitles, ask", watch_skill)
        self.assertIn("Never inspect, download, import, or reference platform automatic captions", translate_skill)
        self.assertIn("Use the current Agent for complete-sentence reconstruction", translate_skill)
        self.assertIn("Do not ask the user for a model ID, provider, processor", translate_skill)
        self.assertIn("Detect the source language from the original audio by default", watch_skill)
        self.assertIn("--write-subs", download)
        self.assertNotIn("--write-auto-subs", download)
        self.assertIn("automatic captions are intentionally excluded", download)
        self.assertNotIn("json3", download.lower())
        self.assertIn("--allow-low-quality", download)
        self.assertIn("fresh", download)
        self.assertIn("media-work/catalog.json", watch_skill)
        self.assertIn("exact-height", watch_skill)
        self.assertIn("single HTTP 403", watch_skill)
        self.assertIn("separately prepared audio track", watch_skill)
        self.assertIn('"timestamp_granularities": ["segment", "word"]', transcriber)
        self.assertIn("--proofread or --translate TARGET_BCP47", portable_add)
        self.assertNotIn("--timing-provider", portable_add)
        self.assertTrue(reflow.is_file())
        self.assertTrue(segmentation.is_file())
        self.assertTrue(revision_import.is_file())
        self.assertIn("BCP 47", translate_skill)
        self.assertIn("separately owns display cuts and Source Alignment", translate_skill)
        self.assertIn("freeze-target", segment_skill)
        self.assertIn("Source Alignment", segment_skill)
        self.assertIn('"agent"', processor_contract)
        for provider in ["local", "openai", "groq", "elevenlabs", "xai", "openrouter"]:
            self.assertIn(f'  "{provider}",', processor_contract)
        self.assertIn("timingProcessor?: TimingProcessorIdentity", job_contract)
        self.assertIn("contentProcessor?: AgentProcessorIdentity", job_contract)
        self.assertIn("segmentationProcessor?: AgentProcessorIdentity", job_contract)
        self.assertIn("processor: SubtitleArtifactProcessor", artifact_contract)
        self.assertNotIn("timingProvider?:", job_contract)
        self.assertNotIn("contentProvider?:", job_contract)

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
        subtitle_style_component = (
            REPO_ROOT / "src" / "client" / "features" / "library" / "SubtitleStylePanel.tsx"
        ).read_text(encoding="utf-8")
        subtitle_style_preferences = (
            REPO_ROOT / "src" / "client" / "lib" / "subtitle-styles.ts"
        ).read_text(encoding="utf-8")
        styles = (
            REPO_ROOT / "src" / "client" / "styles" / "globals.css"
        ).read_text(encoding="utf-8")
        media_card_component = (
            REPO_ROOT / "src" / "client" / "features" / "library" / "MediaCard.tsx"
        ).read_text(encoding="utf-8")
        player_component = (
            REPO_ROOT / "src" / "client" / "features" / "player" / "PlayerDialog.tsx"
        ).read_text(encoding="utf-8")
        player_caption_hook = (
            REPO_ROOT / "src" / "client" / "features" / "player" / "use-player-captions.ts"
        ).read_text(encoding="utf-8")
        usage_component = (
            REPO_ROOT / "src" / "client" / "features" / "home" / "UsageGuideDialog.tsx"
        ).read_text(encoding="utf-8")
        usage_content = (
            REPO_ROOT / "src" / "client" / "features" / "home" / "UsageDialog.tsx"
        ).read_text(encoding="utf-8")
        my_prompts_dialog = (
            REPO_ROOT / "src" / "client" / "features" / "home" / "MyPromptsDialog.tsx"
        ).read_text(encoding="utf-8")
        supported_sites_dialog = (
            REPO_ROOT / "src" / "client" / "features" / "resources" / "SupportedSitesDialog.tsx"
        ).read_text(encoding="utf-8")
        settings_component = (
            REPO_ROOT / "src" / "client" / "features" / "settings" / "TranscriptionSettingsDialog.tsx"
        ).read_text(encoding="utf-8")
        models_component = (
            REPO_ROOT / "src" / "client" / "features" / "resources" / "ModelsDialog.tsx"
        ).read_text(encoding="utf-8")
        model_details_component = (
            REPO_ROOT
            / "src"
            / "client"
            / "features"
            / "resources"
            / "ModelDetailsDialog.tsx"
        ).read_text(encoding="utf-8")
        summary_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "VideoSummaryPanel.tsx"
        ).read_text(encoding="utf-8")
        markmap_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "MarkmapViewer.tsx"
        ).read_text(encoding="utf-8")
        detail_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "JobDetailDialog.tsx"
        ).read_text(encoding="utf-8")
        detail_about_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "JobAboutPanel.tsx"
        ).read_text(encoding="utf-8")
        detail_status_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "JobStatusPanel.tsx"
        ).read_text(encoding="utf-8")
        detail_subtitle_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "SubtitleArtifactPanel.tsx"
        ).read_text(encoding="utf-8")
        subtitle_artifact_ui = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "subtitle-artifact-ui.ts"
        ).read_text(encoding="utf-8")
        subtitle_revision_table = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "SubtitleRevisionTable.tsx"
        ).read_text(encoding="utf-8")
        subtitle_revision_preview = (
            REPO_ROOT
            / "src"
            / "client"
            / "features"
            / "job-detail"
            / "SubtitleRevisionPreviewDialog.tsx"
        ).read_text(encoding="utf-8")
        detail_activity_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "JobActivityPanel.tsx"
        ).read_text(encoding="utf-8")
        detail_history_component = (
            REPO_ROOT / "src" / "client" / "features" / "job-detail" / "JobHistoryCard.tsx"
        ).read_text(encoding="utf-8")
        removal_dialog_component = (
            REPO_ROOT
            / "src"
            / "client"
            / "components"
            / "shared"
            / "removal"
            / "ResourceRemovalDialog.tsx"
        ).read_text(encoding="utf-8")
        video_removal_dialog_component = (
            REPO_ROOT
            / "src"
            / "client"
            / "features"
            / "job-detail"
            / "VideoRemovalDialog.tsx"
        ).read_text(encoding="utf-8")
        removal_contract = (
            REPO_ROOT / "src" / "shared" / "contracts" / "removal.ts"
        ).read_text(encoding="utf-8")
        removal_service = (
            REPO_ROOT / "src" / "server" / "services" / "removal-service.ts"
        ).read_text(encoding="utf-8")
        removal_script = (
            PLUGIN_ROOT
            / "skills"
            / "video-library"
            / "scripts"
            / "remove_library_item.py"
        ).read_text(encoding="utf-8")
        removal_protocol = (
            PLUGIN_ROOT
            / "skills"
            / "video-library"
            / "references"
            / "removal-protocol.md"
        ).read_text(encoding="utf-8")
        app_dialog = (
            REPO_ROOT / "src" / "client" / "components" / "shared" / "AppDialog.tsx"
        ).read_text(encoding="utf-8")
        server_app = (REPO_ROOT / "src" / "server" / "app.ts").read_text(encoding="utf-8")
        server_entry = (REPO_ROOT / "src" / "server" / "bun.ts").read_text(encoding="utf-8")
        serve_script = (
            PLUGIN_ROOT / "skills" / "watch-video" / "scripts" / "serve-library.sh"
        ).read_text(encoding="utf-8")
        python_server = PLUGIN_ROOT / "skills" / "watch-video" / "scripts" / "library_server.py"
        package = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        prompt_contract = (
            REPO_ROOT / "src" / "shared" / "prompts" / "insu-prompts.ts"
        ).read_text(encoding="utf-8")

        self.assertTrue(all(not path.exists() for path in legacy_assets))
        self.assertNotIn("legacyLibraryRoot", server_app + server_entry)
        self.assertNotIn("legacy-library-template", server_entry + serve_script)
        self.assertIn('path.join(options.libraryAppRoot, "assets")', server_app)
        self.assertFalse(python_server.exists())
        self.assertTrue(built_home.is_file())
        self.assertIn('id="root"', built_home.read_text(encoding="utf-8"))
        self.assertTrue(app_icon.is_file())
        self.assertEqual(app_icon.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

        self.assertIn("讓影音跨越語言", react_app)
        self.assertIn("OverlayCoordinator", react_app)
        self.assertIn("加入影音", react_app)
        self.assertIn('className="hero-artwork"', react_app)
        self.assertIn('className="primary-nav"', react_app)
        self.assertIn("開始說明", react_app)
        self.assertIn("我的提示", react_app)
        self.assertIn("轉錄設定", react_app)
        self.assertIn("支援網站", react_app)
        self.assertIn("擴充功能", react_app)
        self.assertIn("影片中心", react_app)
        self.assertIn("LibraryBigIcon", react_app)
        self.assertNotIn("PuzzleIcon", react_app)
        self.assertNotIn("AppearanceDialog", overlays)
        self.assertIn("lazy(", overlays)

        self.assertIn('value="grid"', library_component)
        self.assertIn('value="list"', library_component)
        self.assertIn("我的影音", library_component)
        self.assertIn("下載佇列", library_component)
        self.assertNotIn("CaptionLanguageSelect", library_component)
        self.assertIn("video-grid-card__duration", media_card_component)
        self.assertIn("VideoCardRemovalDialog", library_component)
        self.assertNotIn("VideoListRemovalDialog", library_component)
        self.assertIn('className="job-table"', library_component)
        self.assertIn("搜尋影音", library_component)
        self.assertIn("PlayIcon", library_component)
        self.assertIn("PauseIcon", library_component)
        self.assertNotIn("EllipsisVerticalIcon", library_component)
        self.assertIn("SettingsIcon", library_component)
        self.assertIn("video-grid-card__settings", library_component)
        self.assertIn("onOpen={openJob}", library_component)
        self.assertNotIn('className="job-title-link"', library_component)
        self.assertIn('size="icon"', library_component)
        self.assertIn("TooltipContent", library_component)
        self.assertNotIn('data-label="目前狀態"', library_component)
        self.assertNotIn("01 / INSU COLLECTION", library_component)
        self.assertNotIn("影音處理資訊", library_component)
        self.assertIn("<TableHead>操作</TableHead>", library_component)
        self.assertIn("下載影音", library_component)
        self.assertIn("點擊下載按鈕代表有權下載、轉錄與觀看這項內容", library_component)
        self.assertIn("rightsConfirmed", prompt_contract)
        self.assertIn("詳細資訊", player_component)
        self.assertIn('tab: "about"', player_component)
        self.assertNotIn("查看紀錄", player_component)

        self.assertIn('value="initialize"', usage_component)
        self.assertIn('value="add-media"', usage_component)
        self.assertIn('value="handoff"', usage_component)
        self.assertNotIn('value="after-setup"', usage_component)
        self.assertNotIn('value="agent-flow"', usage_component)
        self.assertIn("1 初始化", usage_component)
        self.assertIn("2 加入影音", usage_component)
        self.assertIn("3 交給 Agent", usage_component)
        self.assertIn("前往加入影音", usage_content)
        self.assertIn("前往交給 Agent", usage_content)
        self.assertNotIn('value="my-prompts"', usage_component)
        self.assertNotIn('value="supported-sites"', usage_component)
        self.assertIn('title="我的提示"', my_prompts_dialog)
        self.assertIn('title="支援網站"', supported_sites_dialog)
        self.assertIn("buildAddVideoPrompt", usage_content)
        self.assertIn("影音網址", usage_content)
        self.assertIn("複製加入提示", usage_content)
        self.assertIn("copyDisabled={!result.prompt}", usage_content)

        self.assertNotIn("Tabs", settings_component)
        self.assertIn("ModelsContent", settings_component)
        self.assertIn("RoutedModelDetailsDialog", settings_component)
        self.assertNotIn("PromptActionCard", models_component)
        self.assertNotIn("ApiKeySelect", models_component)
        self.assertIn("<TableHead>類型</TableHead>", models_component)
        self.assertIn("<TableHead>操作</TableHead>", models_component)
        for model_id in ("tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"):
            self.assertIn(model_id, (REPO_ROOT / "src" / "server" / "services" / "local-model-service.ts").read_text(encoding="utf-8"))
        self.assertIn("下載模型", model_details_component)
        self.assertIn("移除模型", model_details_component)
        self.assertIn("使用這個模型", model_details_component)
        self.assertIn("每次真正上傳前仍會另外詢問你的同意", model_details_component)
        self.assertIn("設定 API Key", model_details_component)
        self.assertNotIn("TranscriptionSettingsContent", models_component)
        self.assertNotIn("buildTranscriptionSettingsPrompt", models_component)
        self.assertIn("PromptActionCard", summary_component)
        self.assertIn("MarkmapViewer", summary_component)
        self.assertIn("ResourceRemovalDialog", summary_component)
        self.assertIn("Transformer", markmap_component)
        self.assertIn("Markmap", markmap_component)

        self.assertIn('value="subtitle-style"', library_component)
        self.assertIn("SubtitleStylePanel", library_component)
        self.assertIn("第一字幕", subtitle_style_component)
        self.assertIn("第二字幕", subtitle_style_component)
        self.assertIn("雙語字幕", subtitle_style_component)
        for label in (
            "文字縮放",
            "文字粗細",
            "文字顏色",
            "背景顏色",
            "背景透明度",
            "文字行距",
            "水平內距",
            "垂直內距",
            "背景圓弧",
            "文字陰影",
            "文字間距",
            "字幕間距",
        ):
            self.assertIn(label, subtitle_style_component)
        self.assertIn("<Table", subtitle_style_component)
        self.assertIn("<TableHeader>", subtitle_style_component)
        self.assertIn("overflow-y: auto", styles)
        self.assertIn("vertical-align: middle", styles)
        self.assertIn("height: 7rem", styles)
        self.assertIn("同步到", subtitle_style_component)
        self.assertNotIn("localStorage", subtitle_style_preferences)
        self.assertIn("subtitleStyleToCss", subtitle_style_preferences)
        self.assertIn("letterSpacing", subtitle_style_preferences)
        self.assertIn('label="第一字幕"', player_component)
        self.assertIn('label="第二字幕"', player_component)
        self.assertIn('type: "player:set-captions"', player_caption_hook)
        self.assertIn('message.type === "player:set-captions"', player)
        self.assertIn("styles?.bilingual?.gap", player)
        self.assertIn("style.letterSpacing", player)

        self.assertIn('value="about"', detail_component)
        self.assertIn('value="status"', detail_component)
        self.assertIn('value="quality"', detail_component)
        self.assertIn('value="subtitles"', detail_component)
        self.assertIn('value="summary"', detail_component)
        self.assertIn('value="outline"', detail_component)
        self.assertNotIn('value="notes"', detail_component)
        self.assertIn('value="activity"', detail_component)
        self.assertIn("字幕管理", detail_component)
        self.assertNotIn('value="source-subtitle"', detail_component)
        self.assertNotIn('value="translated-subtitle"', detail_component)
        self.assertIn("SubtitleManagementPanel", detail_component)
        self.assertIn('"source",', subtitle_artifact_ui)
        self.assertIn('"proofread",', subtitle_artifact_ui)
        self.assertIn('"translation",', subtitle_artifact_ui)
        self.assertIn('"segmentation",', subtitle_artifact_ui)
        self.assertIn("SubtitleManagementProvider", detail_subtitle_component)
        self.assertNotIn("PLAYBACK VERSION", detail_subtitle_component)
        self.assertIn('aria-label="字幕類型"', detail_subtitle_component)
        self.assertIn("SubtitleRevisionTable", detail_subtitle_component)
        self.assertIn("SubtitleRevisionPreviewDialog", detail_subtitle_component)
        self.assertIn("EyeIcon", subtitle_revision_table)
        self.assertIn("ResourceRemovalDialog", subtitle_revision_table)
        self.assertIn("AppDialog", subtitle_revision_preview)
        self.assertNotIn("DialogContent", subtitle_revision_preview)
        self.assertIn("CaptionComparisonTable", subtitle_revision_preview)
        self.assertNotIn("JobHistoryCard", detail_about_component)
        self.assertIn("JobHistoryCard", detail_status_component)
        self.assertNotIn("JobNextActionCard", detail_about_component)
        self.assertIn("VideoRemovalDialog", detail_about_component)
        self.assertNotIn("ScrollArea", detail_history_component)
        self.assertIn('className="history-table__body"', detail_history_component)
        self.assertIn("ResourceRemovalDialog", video_removal_dialog_component)
        self.assertIn("VideoCardRemovalDialog", video_removal_dialog_component)
        self.assertNotIn("VideoListRemovalDialog", video_removal_dialog_component)
        self.assertIn('kind: "video"', video_removal_dialog_component)
        self.assertIn("AlertDialogTrigger", removal_dialog_component)
        self.assertIn("AlertDialogContent", removal_dialog_component)
        self.assertIn("previewRemoval", removal_dialog_component)
        self.assertIn("executeRemoval", removal_dialog_component)
        self.assertIn("Spinner", removal_dialog_component)
        self.assertNotIn("CopyButton", removal_dialog_component)
        self.assertNotIn("Agent", removal_dialog_component)
        self.assertIn("RemovalPreviewResponse", removal_contract)
        self.assertIn("planDigest", removal_contract)
        self.assertIn("Bun.spawn", removal_service)
        self.assertIn('run("verify"', removal_service)
        self.assertIn('"/api/removals/preview"', server_app)
        self.assertIn('"/api/removals/execute"', server_app)
        self.assertIn('HANDLERS: dict[str, RemovalHandler]', removal_script)
        self.assertIn('"video": VideoRemovalHandler()', removal_script)
        self.assertIn('"summary-artifact": SummaryArtifactRemovalHandler()', removal_script)
        self.assertIn("expected_digest != actual_digest", removal_script)
        self.assertIn("ON DELETE CASCADE", removal_protocol)
        self.assertIn("No removal prompt or Agent handoff", removal_protocol)
        self.assertIn("ResourceRemovalDialog", removal_protocol)
        self.assertIn("useSubtitleCatalog", detail_subtitle_component)
        self.assertNotIn("useSubtitleArtifactCaptions", detail_subtitle_component)
        self.assertIn("useSubtitleArtifactCaptions", subtitle_revision_preview)
        self.assertIn("useJobLog", detail_activity_component)
        self.assertNotIn("狀態歷程", detail_activity_component)
        self.assertNotIn("CardHeader", detail_activity_component)
        self.assertNotIn("最近 180 行", detail_activity_component)
        self.assertIn("PromptActionCard", detail_activity_component)

        tabbed_dialogs = usage_component + settings_component + library_component + detail_component
        self.assertEqual(tabbed_dialogs.count('layout="tabbed"'), 3)
        self.assertEqual(tabbed_dialogs.count("app-dialog-tabs"), 3)
        self.assertIn("app-dialog__body--tabbed", app_dialog)
        self.assertIn('app.get("/api/jobs"', server_app)
        self.assertIn('app.get("/api/models"', server_app)
        self.assertIn('"/api/models/selection"', server_app)
        self.assertNotIn('"/api/transcription-settings"', server_app)
        self.assertNotIn('"/api/models/local/active"', server_app)
        self.assertNotIn('"/api/environment"', server_app)
        self.assertIn('"/api/providers/:providerId/credential"', server_app)
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
