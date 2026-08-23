export const WIDTH = 1920;
export const HEIGHT = 1080;
export const GRID = 20;
export const HANDLE_LIST = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const ANIMATIONS = [
  ["", "None"], ["lcyt-fadeIn", "Fade In"], ["lcyt-fadeOut", "Fade Out"],
  ["lcyt-slideInLeft", "Slide In ←"], ["lcyt-slideInRight", "Slide In →"],
  ["lcyt-slideInUp", "Slide In ↑"], ["lcyt-slideInDown", "Slide In ↓"],
  ["lcyt-zoomIn", "Zoom In"], ["lcyt-zoomOut", "Zoom Out"],
  ["lcyt-pulse", "Pulse"], ["lcyt-blink", "Blink"], ["lcyt-typewriter", "Typewriter"],
] as const;

export const KEYFRAMES = `
@keyframes lcyt-fadeIn{from{opacity:0}to{opacity:1}}
@keyframes lcyt-fadeOut{from{opacity:1}to{opacity:0}}
@keyframes lcyt-slideInLeft{from{transform:translateX(-100%)}to{transform:translateX(0)}}
@keyframes lcyt-slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes lcyt-slideInUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes lcyt-slideInDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}
@keyframes lcyt-zoomIn{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes lcyt-zoomOut{from{transform:scale(1);opacity:1}to{transform:scale(0);opacity:0}}
@keyframes lcyt-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes lcyt-blink{0%,100%{opacity:1}50%{opacity:0}}
@keyframes lcyt-typewriter{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}`;
