# Design identity: "Obsidian Intelligence"

Mandatory visual identity for all UI work in this repo. Written originally for a reviews-analytics product; apply the identity, palette, typography and component rules to Hunger Learn (Arabic-first RTL, logo top-right).

<frontend_aesthetics_reviews_analytics_platform>

<design_philosophy>
This is a Reviews Intelligence Platform — not another generic SaaS dashboard. 
The UI must feel like a "command center for reputation" — powerful, insightful, 
but never overwhelming. Think: Bloomberg Terminal meets boutique design studio.

Core tension to balance:
- Data density WITHOUT visual chaos
- Professional authority WITHOUT corporate boredom  
- Analytical precision WITHOUT cold sterility

The platform reveals hidden truths in customer voices. The design should feel 
like "lifting the veil" — moments of clarity emerging from noise.
</design_philosophy>

<aesthetic_identity>
PRIMARY AESTHETIC: "Obsidian Intelligence"
- Dark-mode dominant (not optional — this is the identity)
- Think: premium audio equipment, high-end car dashboards, observatory control rooms
- The darkness isn't just style — it makes data visualization POP
- Light mode exists but feels like "day mode" on a telescope — functional, not primary

INSPIRATION SOURCES (blend these):
- Stripe's precision meets Linear's elegance
- Bloomberg Terminal's density meets Figma's approachability  
- Apple Pro Display marketing meets Vercel's developer aesthetic
- Observatory/mission control rooms — purposeful, focused, powerful
- High-end audio interfaces (Ableton, Logic Pro) — complex but learnable

CULTURAL AESTHETIC: "Tokyo Precision"
- Japanese design principles: Ma (negative space), Kanso (simplicity), 
  Seijaku (tranquility in complexity)
- Grid systems that breathe
- Information hierarchy through restraint, not decoration
</aesthetic_identity>

<color_system>
AVOID COMPLETELY:
- Generic blue (#3B82F6, #2563EB) — every SaaS uses this
- Purple gradients — AI slop signature
- Traffic light sentiment (red/yellow/green) — lazy and inaccessible
- Muted grays that feel dead

PRIMARY PALETTE — "Obsidian Core":
--surface-void: #09090B (true black with warmth)
--surface-primary: #18181B (elevated surfaces)
--surface-secondary: #27272A (cards, containers)
--surface-tertiary: #3F3F46 (subtle borders, dividers)

ACCENT SYSTEM — "Signal Colors" (sentiment without traffic lights):
--sentiment-radiant: #34D399 → #10B981 (positive — emerald glow, not green)
--sentiment-ember: #F97316 → #EA580C (negative — warm ember, not angry red)
--sentiment-neutral: #A1A1AA (neutral — sophisticated gray)
--sentiment-mixed: #FBBF24 (mixed — amber, not warning yellow)

HIGHLIGHT ACCENT — "Electric Signature":
--accent-primary: #06B6D4 (cyan — distinctive, not generic blue)
--accent-glow: rgba(6, 182, 212, 0.15) (for glows, highlights)
--accent-secondary: #8B5CF6 (violet — used sparingly for premium features)

DATA VISUALIZATION PALETTE:
Do NOT use standard chart.js or d3 defaults.
Create a custom palette that feels cinematic:
--viz-01: #06B6D4 (cyan)
--viz-02: #8B5CF6 (violet)  
--viz-03: #F472B6 (pink)
--viz-04: #34D399 (emerald)
--viz-05: #FBBF24 (amber)
--viz-06: #FB7185 (rose)

Use gradients in charts — solid colors feel flat:
Linear gradients with 0.8 → 0.1 opacity for area charts
Radial glows behind key data points
</color_system>

<typography>
ABSOLUTELY FORBIDDEN:
- Inter (every SaaS uses this — instant generic signal)
- Roboto, Open Sans, Lato (Google defaults)
- System fonts as primary

PRIMARY FONT SYSTEM:

Display/Headlines: "Instrument Sans" or "Geist"
- Modern, distinctive, professional
- Variable font for precise weight control
- Use weights: 500 for body headlines, 600 for emphasis, 700 for hero

Body/Data: "Geist Mono" or "JetBrains Mono" for numbers/data
- Monospace for data creates "terminal intelligence" feel
- Numbers should feel precise, technical, trustworthy
- Tabular figures essential for data alignment

Alternative Premium Stack:
- Headlines: "Satoshi" or "Cabinet Grotesk" (startup-fresh)
- Body: "IBM Plex Sans" (technical credibility)
- Data: "IBM Plex Mono" (consistent family)

TYPOGRAPHY RULES:
- Data numbers: ALWAYS monospace, slightly larger than surrounding text
- Percentages and metrics: Use tabular figures, medium weight
- Section headers: Uppercase, letterspaced (0.05em), smaller size — creates sophistication
- Review quotes: Serif accent font (Newsreader, Lora) — humanizes the data
- Size jumps: Use significant scale (3x minimum for hero → body)
</typography>

<layout_architecture>
AVOID:
- Generic sidebar + main content (every dashboard ever)
- Cards floating randomly with equal spacing
- Symmetrical grid of identical metric boxes
- Cluttered headers with too many actions

LAYOUT PHILOSOPHY: "Command Center Hierarchy"

Structure: 
1. TOP BAR: Minimal — logo, branch selector (prominent), user menu
   - Branch/location selector is HERO element — not hidden in sidebar
   - Should feel like "mission selector" — changing context changes everything

2. PRIMARY CANVAS: The main stage
   - NOT a grid of equal cards
   - Hero metric/insight at top — the ONE thing that matters right now
   - Supporting data flows below in intentional hierarchy
   - Use "masonry" or "editorial" layouts — not rigid grids

3. CONTEXTUAL PANELS: Slide-in details
   - Review deep-dives slide from right
   - Filters/controls slide from left
   - Never modal popups for data — modals break analytical flow

SPATIAL PRINCIPLES:
- Generous padding (24px minimum, 32px preferred)
- Cards should "breathe" — never feel cramped
- Use negative space as a design element, not wasted space
- Group related metrics with subtle containment (background shift, not borders)

RESPONSIVE PHILOSOPHY:
- Desktop-first (this is a professional tool)
- Tablet: Stack hero metrics, maintain data density
- Mobile: "Insights mode" — show key metrics, link to desktop for full analysis
</layout_architecture>

<motion_and_interaction>
AVOID:
- Bouncy, playful animations (this is professional software)
- Skeleton loaders everywhere (they've become visual noise)
- Hover effects on everything (decision fatigue)
- Jarring transitions

MOTION PHILOSOPHY: "Purposeful Revelation"

Data Loading:
- Numbers should "count up" to final values (creates anticipation)
- Charts draw themselves — line charts trace their path, bar charts rise
- Use staggered delays (50-100ms between elements) — creates rhythm
- Loading states: Subtle pulse/glow, not spinners

Transitions:
- Page transitions: Content fades + slides subtly (opacity + transform)
- Panel reveals: Slide with slight scale (0.98 → 1.0)
- Filter changes: Data morphs, doesn't jump
- Use cubic-bezier(0.4, 0, 0.2, 1) — smooth, professional

Micro-interactions:
- Hover on data points: Glow effect + tooltip with context
- Click on review: Expand inline OR slide panel (never modal)
- Selection states: Ring/outline with accent glow
- Sentiment badges: Subtle pulse on hover

HIGH-IMPACT MOMENTS:
- First dashboard load: Orchestrated reveal (metrics → charts → insights)
- Branch switch: Smooth morph of data (not hard refresh)
- Report generation: Progress with milestone celebrations
- Insight discovery: Subtle "aha" animation (glow, scale bump)
</motion_and_interaction>

<backgrounds_and_atmosphere>
AVOID:
- Flat solid colors (feel cheap)
- Obvious gradients (feel dated)
- Decorative patterns (feel unprofessional)
- Pure white anywhere (harsh, clinical)

BACKGROUND PHILOSOPHY: "Depth Through Subtlety"

Primary Surfaces:
- Base: Very subtle gradient (--surface-void → slightly lighter at edges)
- Cards: Solid surface color with subtle border (1px, low opacity)
- Never use shadows alone — combine with borders or glows

Atmospheric Effects:
- Subtle noise texture overlay (1-2% opacity) — adds tactile quality
- Very subtle radial gradient behind hero metrics (accent color, 5% opacity)
- "Spotlight" effect: Where user focuses, subtle light increase

Data Visualization Backgrounds:
- Charts on slightly elevated surface (not flat on page)
- Subtle grid lines (8% opacity) — not harsh
- Area under line charts: Gradient fade to surface color

Special Regions:
- Insight/alert areas: Subtle accent glow behind
- Selected items: Very subtle highlight wash
- Hover states: Slight surface elevation
</backgrounds_and_atmosphere>

<components_specific_guidance>

SENTIMENT DISPLAY (core feature — make distinctive):
- NOT pie charts (overused, hard to read)
- Use: Horizontal stacked bars with rounded ends
- OR: "Sentiment rings" — concentric arcs
- OR: "Pulse meter" — custom gauge with glow effects
- Show trend alongside current state always

REVIEW CARDS:
- Review text should feel "human" — use serif font for quotes
- Sentiment indicator: Subtle side border OR background tint
- Star ratings: Custom icons, not yellow stars (try accent-colored dots or bars)
- Show "key phrases" as subtle tags below review

BRANCH SELECTOR:
- This is THE primary navigation — make it prominent
- Not a dropdown — use a command palette style (⌘K pattern)
- Show branch health/status in the selector itself
- Quick-switch keyboard shortcuts

METRIC CARDS:
- Large numbers: 48-64px, monospace, medium weight
- Trend indicator: Arrow + percentage, color-coded but subtle
- Sparkline or mini-chart when relevant
- Label above, value prominent, trend subtle below

CHARTS AND GRAPHS:
- Always custom styled — never default library appearance
- Tooltips: Dark, minimal, precise
- Legends: Below or integrated, never competing with chart
- Axes: Minimal, subtle, only what's necessary

DATA TABLES:
- Alternating row colors: Very subtle (2% difference)
- Row hover: Subtle background shift + left accent border
- Sorting indicators: Minimal arrows, not heavy icons
- Expandable rows for review details

INSIGHT CARDS (AI-generated insights):
- Distinctive styling — users should know this is "smart"
- Subtle accent border or glow
- Icon: Abstract/geometric, not cartoon lightbulb
- Confidence indicator when relevant
</components_specific_guidance>

<anti_patterns_specific_to_this_domain>
NEVER DO THESE:

1. Generic "Reviews" icon (speech bubble with star) — find unique iconography
2. Word clouds — they're visual noise, not insight  
3. Pie charts for sentiment — impossible to compare across time
4. Red/Yellow/Green traffic lights — accessibility nightmare, visually lazy
5. "Powered by AI" badges everywhere — let the intelligence speak for itself
6. Excessive emoji in sentiment display — unprofessional
7. Stock photography of happy customers — feels fake
8. Dense tables as primary view — this isn't Excel
9. Notification badges everywhere — creates anxiety, not insight
10. Generic "Dashboard" as page title — name the specific insight view
</anti_patterns_specific_to_this_domain>

<creative_challenges>
Push beyond conventional thinking:

1. What if sentiment wasn't shown as percentages but as "weather"? 
   (Sunny, cloudy, stormy — more intuitive than 73% positive)

2. What if reviews could be "listened to" not just read?
   (Audio synthesis option, reviews as ambient insight)

3. What if the dashboard had a "focus mode" that showed ONE insight beautifully 
   instead of everything at once?

4. What if branches were shown on an actual map with heat indicators?
   (Geo-spatial sentiment visualization)

5. What if time was shown as "story" not just charts?
   ("In January, customers loved X. But by March, concerns about Y emerged...")

6. What if there was a "mood" of the day summary — one sentence, one emotion?

Implement at least 2-3 of these unexpected elements.
</creative_challenges>

</frontend_aesthetics_reviews_analytics_platform>
