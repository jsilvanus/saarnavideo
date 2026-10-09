/** Global so the rules reach child components (CompositionEditor, TranscriptionEditor, SourcePlayer, SectionManager); styled-jsx removes them when the page unmounts. */
export default function WorkspaceStyles() {
  return (
    <style jsx global>{`
      * {
        box-sizing: border-box;
      }
      .app {
        min-height: 100vh;
        display: flex;
        background: #f6f7f9;
        color: #18202a;
        font-family: system-ui, sans-serif;
      }
      .sidebar {
        width: 270px;
        flex: none;
        background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
        color: white;
        padding: 20px 14px;
        border-right: 2px solid #10b981;
      }
      .brand {
        font-size: 21px;
        font-weight: 750;
        padding: 4px 8px 18px;
        color: #d1fae5;
      }
      .new {
        width: 100%;
        padding: 10px;
        border: 2px solid #10b981;
        border-radius: 8px;
        font-weight: 650;
        margin-bottom: 14px;
        background: #10b981;
        color: white;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .new:hover {
        background: #059669;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
      }
      .projects {
        display: grid;
        gap: 4px;
      }
      .project {
        position: relative;
        display: flex;
        border-radius: 8px;
        transition: all 0.2s ease;
      }
      .project:hover {
        background: rgba(16, 185, 129, 0.15);
      }
      .project.selected {
        background: rgba(16, 185, 129, 0.25);
        border-left: 3px solid #10b981;
        padding-left: 0;
      }
      .project-main {
        flex: 1;
        text-align: left;
        background: none;
        color: #e5e7eb;
        border: 0;
        padding: 10px;
      }
      .project.selected .project-main {
        color: #d1fae5;
      }
      .more {
        background: none;
        color: #cbd5e1;
        border: 0;
        padding: 0 10px;
        font-size: 20px;
      }
      .menu {
        position: absolute;
        right: 4px;
        top: 40px;
        background: white;
        color: #111827;
        border-radius: 8px;
        box-shadow: 0 8px 25px #0003;
        padding: 5px;
        z-index: 3;
        min-width: 150px;
        border: 2px solid #10b981;
      }
      .menu button {
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: 0;
        padding: 9px;
        border-radius: 5px;
        transition: all 0.2s ease;
      }
      .menu button:hover {
        background: #d1fae5;
        color: #059669;
      }
      .danger,
      .dangerButton {
        color: #ef4444 !important;
      }
      .menu button.danger:hover {
        background: #fee2e2;
        color: #ef4444;
      }
      .workspace {
        flex: 1;
        min-width: 0;
      }
      .workspace header {
        min-height: 92px;
        background: white;
        border-bottom: 2px solid #10b981;
        padding: 20px 30px;
        padding-right: 340px;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: space-between;
        align-items: center;
      }
      .header-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .header-actions button {
        min-height: 40px;
        padding: 8px 14px;
        border: 2px solid #10b981;
        border-radius: 8px;
        background: white;
        color: #10b981;
        font-weight: 650;
        transition: all 0.2s ease;
        cursor: pointer;
      }
      .header-actions button:hover {
        background: #d1fae5;
        color: #059669;
      }
      .workspace h1 {
        margin: 0 0 4px;
        font-size: 24px;
        color: #0f172a;
      }
      nav {
        display: flex;
        overflow: auto;
        background: white;
        border-bottom: 2px solid #e5e7eb;
        padding: 0 20px;
      }
      nav button {
        background: none;
        border: 0;
        padding: 14px 11px;
        color: #64748b;
        border-bottom: 3px solid transparent;
        white-space: nowrap;
        transition: all 0.2s ease;
      }
      nav button:hover {
        color: #10b981;
      }
      nav button.active {
        color: #10b981;
        border-bottom-color: #10b981;
        font-weight: 750;
      }
      .content {
        padding: 28px;
        max-width: none;
      }
      .panel {
        background: white;
        border: 2px solid #e5e7eb;
        border-radius: 12px;
        padding: 24px;
        transition: all 0.2s ease;
      }
      .panel:hover {
        border-color: #10b981;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.1);
      }
      .panel h2 {
        margin: 0 0 5px;
        color: #0f172a;
      }
      .form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        align-items: end;
      }
      .form-grid.four {
        grid-template-columns: repeat(4, 1fr);
      }
      label {
        display: grid;
        gap: 6px;
        font-weight: 600;
        font-size: 14px;
        color: #0f172a;
      }
      input,
      select,
      textarea {
        width: 100%;
        padding: 10px;
        border: 2px solid #e5e7eb;
        border-radius: 7px;
        background: white;
        transition: border-color 0.2s ease;
      }
      input:focus,
      select:focus,
      textarea:focus {
        outline: none;
        border-color: #10b981;
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
      }
      .form-grid button,
      .button-row button,
      .row button {
        padding: 10px 12px;
        border: 2px solid #10b981;
        border-radius: 7px;
        background: white;
        color: #10b981;
        transition: all 0.2s ease;
        cursor: pointer;
      }
      .form-grid button:hover,
      .button-row button:hover,
      .row button:hover {
        background: #d1fae5;
        color: #059669;
      }
      .primary {
        background: #10b981 !important;
        color: white !important;
        border: 0 !important;
        border-radius: 8px;
        padding: 10px 15px;
        font-weight: 650;
        transition: all 0.2s ease;
      }
      .primary:hover {
        background: #059669 !important;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 10px;
        margin-top: 20px;
      }
      .card {
        border: 2px solid #e5e7eb;
        border-radius: 9px;
        padding: 13px;
        display: grid;
        gap: 7px;
        transition: all 0.2s ease;
      }
      .card:hover {
        border-color: #10b981;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.1);
      }
      .card b {
        font-size: 11px;
        color: #10b981;
        font-weight: 700;
      }
      .pending-upload {
        display: grid;
        gap: 6px;
      }
      .list {
        display: grid;
        gap: 8px;
        margin-top: 20px;
      }
      .row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border: 2px solid #e5e7eb;
        padding: 12px;
        border-radius: 8px;
        transition: all 0.2s ease;
      }
      .row:hover {
        border-color: #10b981;
        background: #f0fdf4;
      }
      .row span,
      .row small {
        display: grid;
        gap: 3px;
      }
      .button-row {
        display: flex;
        gap: 9px;
        margin-top: 16px;
      }
      .graphic-list {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin: 18px 0;
      }
      .graphic-list button {
        display: grid;
        text-align: left;
        gap: 4px;
        border: 2px solid #d8dee8;
        background: #f8fafc;
        padding: 10px 12px;
        border-radius: 8px;
        color: #18202a;
        font-weight: 700;
        transition: all 0.2s ease;
      }
      .graphic-list button:hover {
        border-color: #10b981;
        background: #d1fae5;
      }
      .graphic-list button.graphic-selected {
        border-color: #10b981;
        background: #d1fae5;
        color: #059669;
      }
      .graphic-list small {
        color: #475569;
        font-weight: 600;
      }
      .graphic-editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-top: 12px;
        margin-bottom: 8px;
        padding: 10px 12px;
        border: 2px solid #10b981;
        border-radius: 9px;
        background: #d1fae5;
      }
      .graphic-editor-header > div:first-child {
        display: grid;
        gap: 2px;
      }
      .graphic-editor-header small {
        color: #059669;
        font-weight: 600;
      }
      .graphic-editor-actions {
        display: flex;
        gap: 6px;
      }
      .icon-button {
        width: 34px;
        height: 34px;
        padding: 0 !important;
        border: 2px solid #10b981;
        border-radius: 7px;
        background: white;
        color: #10b981;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .icon-button:hover {
        background: #d1fae5;
        color: #059669;
      }
      .danger-icon {
        color: #ef4444;
        border-color: #ef4444;
      }
      .danger-icon:hover {
        background: #fee2e2;
        color: #ef4444;
      }
      .composition-editor {
        display: grid;
        gap: 18px;
      }
      .resource-bin {
        border: 2px solid #10b981;
        border-radius: 12px;
        background: #d1fae5;
        padding: 14px;
      }
      .resource-bin-title {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
        margin-bottom: 12px;
      }
      .resource-bin-title span {
        color: #059669;
        font-size: 13px;
        font-weight: 600;
      }
      .resource-bin-grid {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .resource-tile {
        width: 92px;
        height: 92px;
        border: 2px solid #cbd5e1;
        border-radius: 10px;
        background: white;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 7px;
        cursor: grab;
        text-align: center;
        font-size: 12px;
        font-weight: 700;
        overflow: hidden;
        transition: all 0.2s ease;
      }
      .resource-tile:hover {
        border-color: #10b981;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
      }
      .resource-tile span:last-child {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .resource-tile.graphic {
        border-color: #a855f7;
        background: #e9d5ff;
      }
      .resource-tile.graphic:hover {
        border-color: #a855f7;
      }
      .resource-icon {
        font-size: 24px;
        line-height: 1;
      }
      .composition-timeline {
        display: grid;
        gap: 8px;
      }
      .composition-section {
        display: grid;
        gap: 7px;
        border: 2px solid #10b981;
        border-radius: 12px;
        padding: 8px;
        background: #d1fae5;
        box-shadow: 0 1px 2px rgba(16, 185, 129, 0.15);
      }
      .composition-drop-zone {
        height: 28px;
        border: 2px dashed transparent;
        border-radius: 7px;
        color: #10b981;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 12px;
        transition: 0.12s;
      }
      .composition-drop-zone.active {
        height: 44px;
        border-color: #10b981;
        background: #d1fae5;
        color: #059669;
        font-weight: 700;
      }
      .section-header {
        display: flex;
        align-items: center;
        gap: 12px;
        border: 2px solid #10b981;
        border-radius: 10px;
        padding: 7px;
        background: #f0fdf4;
      }
      .section-thumbnail {
        width: 58px !important;
        height: 33px !important;
        border-radius: 5px;
        overflow: hidden;
        background: #111827;
        flex: none;
      }
      .section-thumbnail img,
      .section-thumbnail video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .section-header > div:last-child {
        display: grid;
        gap: 3px;
      }
      .section-header small {
        color: #059669;
        font-weight: 600;
      }
      .section-body {
        display: grid;
        gap: 6px;
        padding-left: 14px;
        border-left: 3px solid #10b981;
        margin-left: 5px;
      }
      .section-main-track {
        border-left: 3px solid #10b981;
        padding-left: 10px;
      }
      .composition-item-card {
        display: grid;
        grid-template-columns: 24px 1fr 30px;
        gap: 8px;
        align-items: center;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        padding: 9px;
        background: #fff;
        cursor: grab;
        transition: all 0.2s ease;
      }
      .composition-item-card:hover {
        border-color: #10b981;
        background: #f0fdf4;
      }
      .composition-item-card > div {
        display: grid;
        gap: 2px;
      }
      .composition-item-card small {
        color: #64748b;
      }
      .composition-item-card button,
      .overlay-card button {
        border: 0;
        background: none;
        font-size: 18px;
        color: #10b981;
        transition: all 0.2s ease;
        cursor: pointer;
      }
      .composition-item-card button:hover {
        color: #059669;
      }
      .item-handle {
        color: #10b981;
      }
      .overlay-track {
        min-height: 70px;
        border: 2px dashed #10b981;
        border-radius: 8px;
        padding: 8px;
        background: #d1fae5;
        position: relative;
      }
      .overlay-track.drop-active {
        border-color: #10b981;
        background: #a7f3d0;
        border-style: solid;
      }
      .track-label {
        font-size: 10px;
        font-weight: 800;
        color: #059669;
        letter-spacing: 0.08em;
        margin-bottom: 7px;
      }
      .overlay-track-line {
        position: relative;
        min-height: 34px;
        background: linear-gradient(to right, #86efac 1px, transparent 1px);
        background-size: 10% 100%;
        border-radius: 5px;
      }
      .overlay-card {
        position: absolute;
        top: 4px;
        height: 26px;
        border-radius: 5px;
        background: #10b981;
        color: white;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        padding: 0 7px;
        min-width: 70px;
        overflow: hidden;
        font-size: 11px;
        font-weight: 700;
      }
      .overlay-card span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .overlay-card button {
        color: white;
        flex: none;
      }
      .overlay-hint {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: #94a3b8;
        font-size: 12px;
      }
      .empty-composition {
        text-align: center;
        padding: 40px;
        color: #64748b;
        border: 1px dashed #cbd5e1;
        border-radius: 10px;
      }
      .preview-panel {
        display: grid;
        gap: 16px;
      }
      .preview-panel video {
        display: block;
        width: min(100%, 960px);
        max-height: 70vh;
        margin: 0 auto;
        border-radius: 10px;
        background: #111827;
      }
      .preview-empty {
        min-height: 280px;
        background: #111827;
        color: white;
        border-radius: 10px;
        display: grid;
        place-items: center;
        text-align: center;
        padding: 30px;
      }
      .preview-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .job {
        display: grid;
        gap: 12px;
        padding: 18px;
        background: #f8fafc;
        border-radius: 9px;
      }
      .job div {
        display: grid;
        gap: 4px;
      }
      .job .button-row,
      .job .job-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        margin: 0;
      }
      .job .stop-button {
        justify-self: start;
        background: #fee2e2;
        color: #b91c1c;
        border: 1px solid #fecaca;
        border-radius: 7px;
        padding: 7px 10px;
        font-weight: 700;
      }
      .quick-step { display: grid; gap: 16px; max-width: 860px; }
      .quick-list { margin: 8px 0 0; padding-left: 18px; }
      .link-button { background: none; color: inherit; padding: 0; text-decoration: underline; font-weight: 600; }
      .downloads {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .downloads a {
        padding: 11px 15px;
        border: 1px solid #d8dee8;
        border-radius: 8px;
        text-decoration: none;
        color: #111827;
      }
      .muted,
      .hint {
        color: #64748b;
        font-size: 14px;
      }
      .success {
        color: #047857;
      }
      .error {
        color: #b91c1c;
      }
      .empty {
        text-align: center;
        margin: 15vh auto;
      }
      .empty button {
        padding: 11px 16px;
        border: 0;
        border-radius: 8px;
        background: #111827;
        color: white;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: #0008;
        display: grid;
        place-items: center;
        z-index: 100;
      }
      .modal {
        background: white;
        border-radius: 12px;
        padding: 24px;
        width: min(560px, calc(100% - 30px));
        box-shadow: 0 20px 50px #0004;
      }
      .modal label {
        margin: 15px 0;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 20px;
        flex-wrap: wrap;
      }
      .actions button {
        padding: 10px 14px;
        border: 0;
        border-radius: 7px;
      }
      .dangerButton {
        background: #fee2e2;
        border-radius: 7px;
        padding: 10px 14px;
        font-weight: 650;
      }
      .warning-list {
        background: #fff7ed;
        border: 1px solid #fed7aa;
        border-radius: 8px;
        padding: 10px;
        display: grid;
        gap: 6px;
      }
      .section-picker {
        display: grid;
        gap: 16px;
      }
      .picker-controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        align-items: end;
      }
      .picker-player {
        border-radius: 10px;
        overflow: hidden;
        background: #111827;
        min-height: 320px;
        display: grid;
        place-items: center;
      }
      .picker-player iframe,
      .picker-player video {
        display: block;
        width: 100%;
        aspect-ratio: 16/9;
        border: 0;
        background: #000;
      }
      .picker-time {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 0;
      }
      .picker-buttons {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .picker-buttons button {
        padding: 10px 12px;
        border: 0;
        border-radius: 7px;
        background: #e5e7eb;
      }
      .range-inputs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .transcription-editor {
        display: grid;
        gap: 16px;
      }
      .transcription-mode-toggle {
        display: flex;
        gap: 8px;
      }
      .transcription-mode-toggle button {
        padding: 9px 13px;
        border: 1px solid #d8dee8;
        border-radius: 7px;
        background: #f8fafc;
        color: #475569;
        font-weight: 650;
      }
      .transcription-mode-toggle button.mode-active {
        background: #111827;
        color: white;
        border-color: #111827;
      }
      .transcription-start-row {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
        padding: 14px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #f8fafc;
      }
      .transcription-upload {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .transcription-upload input[type="file"] {
        width: auto;
      }
      .job-progress {
        display: grid;
        gap: 8px;
        padding: 14px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #f8fafc;
      }
      .job-status-line {
        font-weight: 650;
      }
      .progress-bar {
        height: 8px;
        border-radius: 4px;
        background: #e5e7eb;
        overflow: hidden;
      }
      .progress-bar > div {
        height: 100%;
        background: #111827;
        transition: width 0.2s;
      }
      .job-progress .stop-button {
        justify-self: start;
        background: #fee2e2;
        color: #b91c1c;
        border: 1px solid #fecaca;
        border-radius: 7px;
        padding: 7px 10px;
        font-weight: 700;
      }
      .run-list {
        display: grid;
        gap: 10px;
      }
      .run-card {
        display: grid;
        gap: 6px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 13px;
        background: white;
      }
      .run-card-head {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        align-items: baseline;
      }
      .run-card-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .segment-list-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 20px;
      }
      .segment-list {
        display: grid;
        gap: 8px;
      }
      .segment-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 10px;
        align-items: start;
        border: 1px solid #e5e7eb;
        border-radius: 9px;
        padding: 11px;
        background: white;
      }
      .segment-row.segment-current {
        border-color: #111827;
        background: #eef2ff;
      }
      .segment-times {
        display: grid;
        gap: 6px;
        width: 150px;
      }
      .segment-seek {
        padding: 8px;
        border: 1px solid #d8dee8;
        border-radius: 7px;
        background: #e5e7eb;
        font-weight: 650;
      }
      .segment-times label {
        font-size: 12px;
      }
      .segment-delete {
        align-self: start;
        border: 0;
        background: none;
        font-size: 16px;
        padding: 6px;
      }
      .add-line {
        display: grid;
        gap: 8px;
        border: 1px dashed #cbd5e1;
        border-radius: 10px;
        padding: 13px;
        margin-top: 6px;
      }
      .add-line-fields {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .step-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        align-items: flex-start;
      }
      .step-main {
        flex: 999 1 560px;
        min-width: 0;
        display: grid;
        gap: 20px;
      }
      .step-aside {
        flex: 1 1 340px;
        min-width: 0;
        display: grid;
        gap: 20px;
      }
      .step-stack {
        display: grid;
        gap: 20px;
      }
      .step-main,
      .step-aside,
      .step-stack {
        grid-template-columns: minmax(0, 1fr);
      }
      .subhead {
        margin: 20px 0 6px;
        font-size: 16px;
      }
      .inline-select {
        width: auto;
        padding: 5px 8px;
        font-size: 12px;
      }
      .composition-sections {
        margin-top: 18px;
      }
      .composition-sections summary {
        cursor: pointer;
        font-weight: 650;
        margin-bottom: 10px;
      }
      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .chip {
        margin-left: 6px;
        padding: 3px 10px;
        border: 1px solid #c7d2fe;
        border-radius: 999px;
        background: #eef2ff;
        color: #3730a3;
        font-size: 12px;
        cursor: pointer;
      }
      .podcast-range {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        align-items: end;
      }
      .podcast-range > button,
      .podcast-range > small,
      .podcast-range-bar {
        grid-column: 1 / -1;
      }
      .podcast-range > button {
        justify-self: start;
        padding: 8px 12px;
        border: 0;
        border-radius: 7px;
        background: #e5e7eb;
        color: #18202a;
      }
      .podcast-range-bar {
        position: relative;
        height: 14px;
        border-radius: 7px;
        background: #e5e7eb;
        overflow: hidden;
      }
      .podcast-range-bar div {
        position: absolute;
        top: 0;
        bottom: 0;
        background: #111827;
      }
      @media (max-width: 760px) {
        .app {
          flex-direction: column;
        }
        .app .sidebar {
          width: 100% !important;
          padding: 12px !important;
        }
        .app .sidebar .projects {
          display: flex !important;
          overflow-x: auto;
        }
        .app .sidebar .brand,
        .app .sidebar .new {
          display: block !important;
        }
        .sidebar-toggle {
          display: none !important;
        }
        .project {
          flex: none;
        }
        .content {
          padding: 14px !important;
        }
        .panel {
          padding: 16px;
        }
        .panel :is(label, select, input, textarea, video, iframe) {
          min-width: 0;
          max-width: 100%;
        }
        .form-grid,
        .form-grid.four,
        .picker-controls,
        .range-inputs,
        .transcription-editor,
        .section-picker,
        .composition-editor,
        .composition-timeline,
        .composition-section,
        .section-body {
          grid-template-columns: minmax(0, 1fr) !important;
        }
        .resource-bin-title,
        .button-row,
        .transcription-upload,
        .slate-section-card,
        .section-header {
          flex-wrap: wrap;
        }
        .transcription-upload input[type="file"] {
          width: 100%;
        }
      }
      @media (max-width: 850px) {
        .workspace header {
          padding: 70px 16px 16px;
        }
        .sidebar {
          width: 220px;
        }
        .content {
          padding: 18px;
        }
        .form-grid,
        .form-grid.four,
        .range-inputs,
        .picker-controls,
        .add-line-fields {
          grid-template-columns: 1fr;
        }
        .timeline-item {
          grid-template-columns: 25px 1fr;
        }
        .timeline-item > select {
          grid-column: 2;
        }
        .resource-bin-grid {
          overflow-x: auto;
          flex-wrap: nowrap;
        }
        .section-body {
          padding-left: 0;
        }
        .segment-row {
          grid-template-columns: 1fr;
        }
        .segment-times {
          width: auto;
        }
      }
    `}</style>
  );
}
