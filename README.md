# Infinite Heroes V2: AI-Powered Comic Creator 🦸‍♂️💥📖

> **Transform your imagination into stunning comic book adventures!**

[![Live Demo](https://img.shields.io/badge/🚀_Try_It_Now-Live_Demo-blue?style=for-the-badge)](https://thiinkmg.github.io/infinite-heroes-comic-creator-V2/)
[![Powered by Gemini](https://img.shields.io/badge/Powered_by-Google_Gemini-4285F4?style=for-the-badge&logo=google)](https://ai.google.dev/)
[![Claude](https://img.shields.io/badge/Writing_by-Claude-D97757?style=for-the-badge)](https://www.anthropic.com/)

**Infinite Heroes** is your personal AI comic studio. Claude writes the story, Gemini draws it, and a model-sheet pipeline keeps your characters recognisable from the cover to the last page.

🎮 **[Try the Live Demo](https://thiinkmg.github.io/infinite-heroes-comic-creator-V2/)** — bring your own Google AI Studio key, no installation required.

---

## 🆕 What's New in V2

V2 is a rebuild of how the app keeps characters consistent, plus a long pass over the things that were built but never reachable.

### Character consistency

- **Character model sheets.** Each character is drawn once as a turnaround — front, three-quarter, profile, plus expression studies — in your chosen art style. Every page then copies that sheet instead of re-interpreting your original photo. Style transfer is solved once rather than re-rolled on every page, which was the single largest source of face drift.
- **Rewritten prompt engine.** Every visual fact about a character is now stated exactly once, next to that character's reference image. The previous builder restated the same face, hair, and skin values across 8–14 differently-worded blocks per request, which spent the model's attention reconciling near-duplicates instead of drawing the scene.
- **Structured art direction.** The writer emits subject, action, setting, camera, and lighting as separate fields rather than prose that then had to be parsed.
- **Attribute locking.** Pin a character's face, costume, emblem, or weapon and it is enforced as a hard constraint on every page.
- **Optional visual QA.** After each page, a vision model scores the render against the character's reference and can reroll once with a targeted correction.

### Lettering and layout

- **Speech bubble editor** — place, drag, resize, and retype bubbles by hand. Six shapes, tail control, per-character assignment.
- **SFX editor** — place and scale sound effects from a library.
- Both are composited into PDF and image export, so what you see is what you get.

### Practical

- **Bring your own cover** — upload existing key art and skip generating one.
- **Session restore** — reload any recent comic from the setup screen.
- **Zipped exports** — one archive instead of a burst of separate downloads.
- **Print-aware export** — comic trim size, CMYK conversion, and resolution options.
- **Accessibility** — real alt text drawn from each page's narrative, a full text reading mode, live progress announcements, and keyboard-reachable controls.

---

## ✨ What Makes It Special?

🎨 **AI-Generated Art** — Every panel drawn by Gemini 3 Pro Image
🦸 **Character Model Sheets** — Turnarounds keep your heroes on-model across the issue
🔒 **Attribute Locking** — Pin a face, costume, emblem, or weapon and it stays put
💬 **Hand Lettering** — Fix bubbles and SFX yourself instead of rerolling the page
📖 **Two Story Modes** — Interactive choices, or a full comic from an outline
🌍 **Multiple Languages** — English, Spanish, French, and more
📱 **Mobile Friendly** — Create on any device
📥 **Print-Ready Export** — PDF at comic trim size, CMYK, or a zip of images

---

## 🖼️ See It In Action

### Create Your Hero
Upload a character portrait and watch the AI analyze it for perfect consistency across your comic!

<p align="center">
  <img src="assets/home-populated-app-screenshot.png" alt="Character Setup" width="700"/>
</p>

### Choose Your Adventure Mode

**🎭 Novel Mode** — Make choices that shape the story!
**📋 Outline Mode** — AI generates the full plot, you approve it!

<p align="center">
  <img src="assets/mode-select-app-screenshot.png" alt="Mode Selection" width="500"/>
</p>

### Watch Your Comic Come to Life

<p align="center">
  <img src="assets/novel-mode-image1-app-screenshot.png" alt="Novel Mode Reading" width="700"/>
</p>

### Interactive Decision Points
Your choices matter! Shape the narrative at key moments.

<p align="center">
  <img src="assets/novel-mode-image3-app-screenshot.png" alt="Interactive Choices" width="700"/>
</p>

### Regenerate & Perfect
Not happy with a panel? Reroll with custom instructions!

<p align="center">
  <img src="assets/reroll-app-screenshot.png" alt="Reroll Panel" width="600"/>
</p>

### Browse Your Masterpiece
Full gallery view with easy navigation.

<p align="center">
  <img src="assets/gallery-app-screenshot.png" alt="Gallery View" width="700"/>
</p>

### Export & Share
Professional PDF export with custom covers!

<p align="center">
  <img src="assets/export-comic-app-screenshot.png" alt="Export Options" width="500"/>
</p>

---

## 🎯 Comic Gallery

Check out what's possible with Infinite Heroes! Every image below was AI-generated:

### 📚 Cover Art Gallery

<p align="center">
  <img src="assets/comic-book-examples/Comic-cover.png" alt="Comic Cover" width="220"/>
  <img src="assets/comic-book-examples/Vile-lence-00-Cover.png" alt="Vile-lence Cover" width="220"/>
  <img src="assets/comic-book-examples/Death-Punch-00-Cover (1).png" alt="Death Punch Cover" width="220"/>
  <img src="assets/comic-book-examples/Comic-cover2.2.png" alt="Comic Cover 2" width="220"/>
</p>

### 📖 Interior Pages

<p align="center">
  <img src="assets/comic-book-examples/Blood and 'Vile'lence-Page-1.png" alt="Vile-lence Page 1" width="220"/>
  <img src="assets/comic-book-examples/Death-Punch-Page-05.png" alt="Death Punch Page 5" width="220"/>
  <img src="assets/comic-book-examples/Death-Punch-Page-09.png" alt="Death Punch Page 9" width="220"/>
  <img src="assets/comic-book-examples/Comic-page-6.png" alt="Comic Page 6" width="220"/>
</p>

<p align="center">
  <img src="assets/comic-book-examples/Comic-page-1.png" alt="Comic Page 1" width="220"/>
  <img src="assets/comic-book-examples/Comic-page-2.png" alt="Comic Page 2" width="220"/>
  <img src="assets/comic-book-examples/Comic-page-4 (2).png" alt="Comic Page 4" width="220"/>
</p>

### 🎭 Character Consistency

The same characters maintain their look across every page:

<p align="center">
  <img src="assets/comic-book-examples/Colleen-Hero-Image1.png" alt="Hero Character" width="200"/>
  <img src="assets/comic-book-examples/Gemini_Generated_Image_gws4t7gws4t7gws4.png" alt="Generated Character" width="200"/>
</p>

### 📕 Back Covers Too!

<p align="center">
  <img src="assets/comic-book-examples/Vile-lence-99-BackCover.png" alt="Back Cover Example" width="280"/>
</p>

---

## 🚀 Features at a Glance

| Feature | Description |
|---------|-------------|
| 🎨 **Genre Selection** | Superhero, Sci-Fi, Fantasy, Noir, Horror, Romance & more |
| 🖌️ **Art Styles** | Classic, Manga, Watercolor, Digital, Vintage & custom |
| 👥 **Multiple Characters** | Hero, Co-Star, and unlimited supporting cast |
| 📏 **Variable Length** | 6 to 24+ pages per issue |
| 🔄 **Smart Rerolls** | Regenerate any panel with custom instructions |
| 💾 **Auto-Save** | Never lose your work |
| 📚 **Preset Library** | Save your favorite configurations |
| 🎯 **Character Profiles** | AI-analyzed visual consistency system |

---

## 🛠️ Quick Start (Local Development)

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- [Google Gemini API Key](https://ai.google.dev/)

### Installation

```bash
# Clone the repo
git clone https://github.com/ThiinkMG/infinite-heroes-comic-creator.git
cd infinite-heroes-comic-creator

# Install dependencies
npm install

# Create your environment file
echo "GEMINI_API_KEY=your_gemini_key_here" > .env.local
echo "ANTHROPIC_API_KEY=your_claude_key_here" >> .env.local  # Optional

# Launch!
npm run dev
```

Open `http://localhost:3000` and start creating! 🎉

---

## ☁️ Deploy Your Own

This project deploys perfectly on [Vercel](https://vercel.com):

1. Fork this repository
2. Connect to Vercel
3. Add environment variables:
   - `GEMINI_API_KEY` — Your Google AI Studio key (required)
   - `ANTHROPIC_API_KEY` — Your Claude API key (optional, enhances text quality)
   - `ADMIN_PASSWORD` — Optional admin access
4. Deploy! 🚀

> 💡 **Tip:** Claude enhances dialogue and story generation. Gemini handles all image generation.

---

## 🤖 Powered By

- **Google Gemini 2.5 Pro** — Narrative generation
- **Google Gemini 3 Pro** — Image generation (experimental)
- **Anthropic Claude** — Enhanced dialogue (optional)

---

## 👥 Credits

- **Vision & Design**: [Thiink Media Graphics](https://thiinkmedia.com)
- **Development**: Antigravity AI + Claude Code
- **Special Thanks**: The comic book community for inspiration

---

## 📜 License

Apache 2.0 — See [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>🌟 Star this repo if you love comics! 🌟</strong>
  <br><br>
  <a href="https://infinite-heroes-comic-creator.vercel.app/">
    <img src="https://img.shields.io/badge/🎮_CREATE_YOUR_COMIC-Try_Now-purple?style=for-the-badge" alt="Create Your Comic"/>
  </a>
</p>

---

*Built with React, Vite, TypeScript, and ❤️ for comic book lovers everywhere.*


---

## 🔑 Using the Live Demo

The demo build ships with **no API keys**. On first use it asks for your own
Google AI Studio key, which is stored only in your browser's local storage and
sent only to Google.

Get a free key at [aistudio.google.com](https://aistudio.google.com/app/apikey).

An Anthropic key is optional. With one, Claude writes the story beats, outlines,
and character profiles; without one, Gemini handles the writing too.

## 🏗️ Running It Yourself

```bash
npm install
cp .env.example .env.local   # add your GEMINI_API_KEY
npm run dev
```

```bash
npm run lint    # TypeScript
npm test        # unit tests
npm run build   # production build
```

> **Note on keys and deployment.** Vite inlines `process.env` values into the
> built JavaScript, so a normal build embeds whatever is in `.env.local`. That is
> fine locally. For any public deployment, build with `DEMO_BUILD=1`, which
> suppresses every secret and lets visitors supply their own key.

## 📦 Version History

**V2** — this repository. Model sheets, rewritten prompt engine, lettering
editors, session restore, and an accessibility pass.

**V1** — [infinite-heroes-comic-creator](https://github.com/ThiinkMG/infinite-heroes-comic-creator),
kept for reference.
