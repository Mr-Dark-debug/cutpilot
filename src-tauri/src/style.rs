//! Editing styles: house rules (instructions), cut tightness, B-roll rhythm, and
//! optional analyzed reference videos.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::util;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RefMetrics {
    pub duration: f64,
    pub analyzed_seconds: f64,
    pub cuts: usize,
    pub cuts_per_min: f64,
    pub avg_shot: f64,
    pub median_shot: f64,
    pub words_per_min: f64,
    pub speech_ratio: f64,
    pub avg_pause: f64,
    pub long_pauses_per_min: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StyleSummary {
    pub summary: String,
    pub pacing: String,
    pub hook: String,
    pub broll: String,
    pub on_screen_text: String,
    pub rules: Vec<String>,
    pub pause_keep: f64,
}

pub fn style_summary_schema() -> serde_json::Value {
    serde_json::json!({
      "type": "object", "additionalProperties": false,
      "required": ["summary", "pacing", "hook", "broll", "on_screen_text", "rules", "pause_keep"],
      "properties": {
        "summary": {"type": "string"},
        "pacing": {"type": "string"},
        "hook": {"type": "string"},
        "broll": {"type": "string"},
        "on_screen_text": {"type": "string"},
        "rules": {"type": "array", "items": {"type": "string"}},
        "pause_keep": {"type": "number"}
      }
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RefAnalysis {
    pub name: String,
    pub input: String,
    pub analyzed: String,
    pub metrics: RefMetrics,
    pub style: StyleSummary,
    pub thumb: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Style {
    pub id: String,
    pub name: String,
    pub description: String,
    pub builtin: bool,
    /// Markdown house rules given to the AI editor.
    pub instructions: String,
    /// Pauses (s) inside kept speech that are left alone; longer ones are cut.
    pub pause_keep: f64,
    /// Suggested seconds between B-roll shots (0 = none).
    pub broll_every: f64,
    pub titles: bool,
    pub captions: bool,
    /// Target length in seconds (0 = whatever the content needs).
    pub target_length: f64,
    pub aspect: String,
    pub color: String,
    /// lucide icon name shown in the style picker.
    pub icon: String,
    /// Group in the style picker (e.g. "YouTube", "Short-form", "Learning").
    pub category: String,
    pub references: Vec<RefAnalysis>,
    pub updated: String,
}

#[allow(clippy::too_many_arguments)]
fn preset(
    id: &str,
    name: &str,
    category: &str,
    icon: &str,
    description: &str,
    color: &str,
    pause_keep: f64,
    broll_every: f64,
    target_length: f64,
    aspect: &str,
    instructions: &str,
) -> Style {
    Style {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        builtin: true,
        instructions: instructions.trim().into(),
        pause_keep,
        broll_every,
        titles: true,
        captions: aspect == "9:16",
        target_length,
        aspect: aspect.into(),
        color: color.into(),
        icon: icon.into(),
        category: category.into(),
        references: vec![],
        updated: String::new(),
    }
}

pub fn builtins() -> Vec<Style> {
    vec![
        preset(
            "talking-head",
            "YouTube talking head",
            "YouTube",
            "video",
            "Commentary, opinion and explainer videos to camera: tight jump cuts, hook first",
            "violet",
            0.35,
            10.0,
            0.0,
            "16:9",
            r#"
**Goal:** a tight, high-retention YouTube video where every sentence earns its place.

**Hook (first 5–15 s)**
- Open with the most specific, curiosity-driving line: the promise, the problem, a bold claim or a result. Move it to the front only if it makes sense out of context.
- Cut "hey guys, welcome back", channel intros and "before we start" chatter unless the brief asks for them. A short greeting can follow the hook.

**What to cut**
- Every retake and false start: keep the last complete take unless an earlier one is clearly stronger.
- Meta talk ("let me say that again", "is this recording?", "wait"), filler-only lines, dead air, repeated points and tangents that don't serve the topic.
- Long setups that delay the payoff; tighten to the point.

**Pacing**
- Jump cuts between sentences are fine and expected. Keep a natural breath where a joke or emphasis needs it.

**Structure**
- Hook → context (why this matters) → main points in a clear order → recap or takeaway → call to action.
- One section per main point, labelled clearly. Chapters for videos over ~3 minutes.

**B-roll**
- Over explanations, lists, examples and anything the speaker describes visually. Never over the hook's first seconds, punchlines or the call to action.

**On-screen text**
- Titles for section changes, callouts for key numbers, names, terms and steps. Max 6 words each.

**Ending**
- End on the call to action or a strong final line. Cut everything after it ("okay, stop recording").
"#,
        ),
        preset(
            "vlog",
            "Vlog / day in the life",
            "YouTube",
            "camera",
            "Personal vlogs: story and atmosphere kept, natural pauses, lots of B-roll",
            "amber",
            0.8,
            7.0,
            0.0,
            "16:9",
            r#"
**Goal:** an enjoyable story of the day that feels personal and natural, not over-cut.

**Hook**
- Tease the most interesting moment of the day in the first 10 seconds (a reveal, a reaction, a question), then go back to the start.

**What to cut**
- Repeated takes, boring logistics (walking, driving, waiting, setting up the camera), "uh, so yeah" endings and long silences.
- Keep moments with emotion, humour, reactions and genuine conversation, even if imperfect.

**Pacing**
- Leave natural breathing room; don't jump-cut every pause. Speed things up in transitions, slow down for meaningful moments.

**Structure**
- Chronological story with clear "scenes" (morning, location A, location B, evening). Label each section by place or activity.
- Chapters for each part of the day if longer than ~5 minutes.

**B-roll**
- Use the B-roll library generously: establishing shots of places, details, food, hands, scenery between talking parts and as transitions between scenes.

**On-screen text**
- Location and time titles ("Mumbai, 7 AM"), occasional funny captions. Keep it light.

**Ending**
- A reflective or funny closing line, then the outro/CTA.
"#,
        ),
        preset(
            "travel",
            "Travel vlog",
            "YouTube",
            "plane",
            "Places, food and experiences: scenic B-roll, location titles, story of the trip",
            "sky",
            0.7,
            5.0,
            0.0,
            "16:9",
            r#"
**Goal:** make viewers feel like they're on the trip, and give useful info (costs, tips, how to get there).

**Hook**
- Open with the most stunning view or the most surprising moment, plus one line on where we are.

**What to cut**
- Retakes, navigation confusion, waiting, repetitive "this is so beautiful" lines (keep the best one), technical problems.

**Structure**
- Arrival → places/experiences in order → food → practical tips (prices, transport, best time) → final thoughts.
- One section per place or experience; chapters for each.

**B-roll**
- Heavy: landscapes, streets, food close-ups, signs, transport, people (non-identifiable), timelapses. Roughly every 5 seconds when the speaker describes a place.

**On-screen text**
- Location titles, prices and practical facts as callouts ("Entry: ₹500", "Open 6am–6pm").

**Ending**
- Overall verdict ("Is it worth it?") and the call to action.
"#,
        ),
        preset(
            "tutorial",
            "Tutorial / how-to",
            "Learning",
            "list-checks",
            "Step-by-step guides and screen recordings: every step kept and labelled",
            "green",
            0.6,
            0.0,
            0.0,
            "16:9",
            r#"
**Goal:** a viewer can follow along and succeed on the first try.

**Hook**
- Show the end result first ("by the end you'll have…") in the first 10 seconds.

**What to cut**
- Mistakes and dead ends, unless the fix is part of the lesson. Remove only when a corrected version exists.
- Waiting (loading, exporting, installing), long silences, repeated explanations.
- NEVER remove a step or a required setting, even if it's boring.

**Pacing**
- Keep short pauses where the viewer needs to see an action happen. Don't cut in the middle of an on-screen action.

**Structure**
- Result preview → what you need (prerequisites) → numbered steps → common problems → recap.
- Title each step ("Step 3 – Export settings") and add a chapter for each step.

**B-roll**
- Rarely; only when it clarifies something not visible in the main footage.

**On-screen text**
- Step titles, keyboard shortcuts, exact values and settings as callouts.
"#,
        ),
        preset(
            "explainer",
            "Educational explainer",
            "Learning",
            "graduation-cap",
            "Teach one topic clearly: accurate, structured, examples kept",
            "blue",
            0.45,
            12.0,
            0.0,
            "16:9",
            r#"
**Goal:** the viewer understands one topic clearly and remembers the key ideas.

**Hook**
- Open with the question the video answers or a surprising fact about it.

**What to cut**
- Retakes, stumbles, meta talk and dead air.
- Never cut a sentence in a way that changes meaning, drops a condition/caveat or removes a definition the rest of the video depends on.

**Pacing**
- Calm and clear rather than hyper-fast. Leave a beat after important statements.

**Structure**
- Question → simple explanation → examples/analogies → common misconceptions → summary of key points.
- One section per idea; chapters for videos over ~3 minutes.

**B-roll**
- Diagrams, objects and examples mentioned in the explanation. Generic and accurate; nothing misleading.

**On-screen text**
- Key terms, definitions, numbers and the 3–5 main takeaways as callouts.

**Notes**
- Flag anything that sounds factually questionable so the creator can double-check.
"#,
        ),
        preset(
            "podcast",
            "Podcast / interview",
            "Long-form",
            "mic",
            "Conversations: answers kept whole, crosstalk and dead air removed",
            "slate",
            0.7,
            0.0,
            0.0,
            "16:9",
            r#"
**Goal:** a conversation that flows and stays interesting without losing what people actually said.

**Hook**
- Cold open: a 10–30 second highlight from later in the conversation (the most quotable answer), then the intro.

**What to cut**
- False starts, crosstalk, "can you hear me?", technical interruptions, long silences, off-topic tangents that go nowhere.
- Keep questions and answers complete; never splice half-answers together into something the guest didn't say.

**Pacing**
- Conversational; keep natural reactions and laughter. Trim long "umm" thinking pauses.

**Structure**
- Cold open → intro → topics in order → closing question → outro.
- One section and chapter per topic.

**On-screen text**
- Lower third with each speaker's name the first time they speak (if names are in the brief or transcript). Topic titles at chapter starts.
"#,
        ),
        preset(
            "shorts",
            "Shorts / Reels / TikTok",
            "Short-form",
            "smartphone",
            "Under 60 s, vertical, hook in 2 s, every pause removed",
            "pink",
            0.15,
            4.0,
            55.0,
            "9:16",
            r#"
**Goal:** a vertical short people watch to the end and replay.

**Hook (first 1–2 s)**
- Start mid-thought with the boldest line: a claim, a question or the payoff. No greetings, no "so today".

**What to cut**
- Everything that isn't the single best idea. The finished video must be under 60 seconds.
- Every pause, breath, filler, retake and transition phrase.

**Pacing**
- Very fast. A new visual (cut, B-roll or text) every 2–4 seconds.

**Structure**
- Hook → 2–4 quick points or one story → payoff → loop back to the hook or a quick CTA.

**B-roll**
- Frequent, short cut-aways (1.5–3 s) that illustrate each point.

**On-screen text**
- Big callouts for key words (2–4 words). Captions are burned in for Shorts.
"#,
        ),
        preset(
            "review",
            "Product review / unboxing",
            "YouTube",
            "package-open",
            "Reviews and unboxings: verdict up front, pros/cons, close-up B-roll",
            "orange",
            0.4,
            6.0,
            0.0,
            "16:9",
            r#"
**Goal:** help the viewer decide whether to buy, quickly and honestly.

**Hook**
- Open with the verdict teaser or the most surprising finding ("I didn't expect this…").

**What to cut**
- Retakes, fumbling with the box, long silent unboxing stretches (keep the best reveal moments), repeated specs.

**Structure**
- Hook → what it is and price → unboxing/first look → design → key features/tests → pros → cons → who it's for → verdict.
- Section and chapter for each part.

**B-roll**
- Product close-ups, details, ports/buttons, in-use shots whenever a feature is mentioned.

**On-screen text**
- Price, key specs and scores as callouts; "Pros" and "Cons" titles.

**Notes**
- Flag claims about prices or specs that should be double-checked.
"#,
        ),
        preset(
            "gaming",
            "Gaming / commentary",
            "YouTube",
            "gamepad-2",
            "Let's plays and commentary: highlights kept, dead gameplay trimmed",
            "purple",
            0.5,
            0.0,
            0.0,
            "16:9",
            r#"
**Goal:** an entertaining video built around the best moments and reactions.

**Hook**
- Open with the most exciting or funniest moment, then rewind.

**What to cut**
- Menus, loading screens, long walks/grinding without commentary, repeated failed attempts (keep one or two if funny), silence.
- Keep genuine reactions, jokes and clutch moments.

**Pacing**
- Energetic. Speed through filler, slow down for highlights.

**Structure**
- Hook → setup/goal → key moments in order → climax → reaction/outro.

**On-screen text**
- Short funny captions or context callouts ("2 HP left"). Section titles for levels or matches.
"#,
        ),
        preset(
            "cooking",
            "Cooking / recipe",
            "Lifestyle",
            "chef-hat",
            "Recipes: ingredients and every step kept, process B-roll",
            "red",
            0.5,
            6.0,
            0.0,
            "16:9",
            r#"
**Goal:** a recipe someone can actually cook from the video.

**Hook**
- Show the finished dish first (the "money shot") with one line on why it's worth making.

**What to cut**
- Retakes, waiting (boiling, baking), cleaning up, repeated stirring. Never cut an ingredient, quantity, temperature or time.

**Structure**
- Finished dish → ingredients → steps in order → plating/tasting → tips and variations.
- Title each step; chapters for ingredients and each main step.

**B-roll**
- Close-ups of ingredients, cutting, sizzling, pouring and the final dish whenever a step is described.

**On-screen text**
- Ingredient quantities, temperatures and times as callouts ("180°C · 25 min").
"#,
        ),
        preset(
            "fitness",
            "Fitness / workout",
            "Lifestyle",
            "dumbbell",
            "Workouts and form tips: every exercise labelled with sets and reps",
            "emerald",
            0.45,
            0.0,
            0.0,
            "16:9",
            r#"
**Goal:** viewers can follow the workout safely.

**Hook**
- Open with the outcome or the challenge ("10-minute full-body, no equipment").

**What to cut**
- Retakes, setting up equipment, long rests (shorten them), repeated cues. Keep all safety and form cues.

**Structure**
- Intro → warm-up → exercises in order → cool-down → recap.
- Title each exercise with sets/reps or time; chapters per exercise block.

**On-screen text**
- Exercise names, reps/sets/time and key form cues as callouts.
"#,
        ),
        preset(
            "course",
            "Course / lecture / webinar",
            "Learning",
            "presentation",
            "Long lessons and talks: content complete, waiting and tech issues removed",
            "indigo",
            0.7,
            0.0,
            0.0,
            "16:9",
            r#"
**Goal:** a clean, complete lesson that's easy to navigate.

**What to cut**
- Waiting for people to join, "can you see my screen?", technical problems, long silences, admin talk and off-topic Q&A.
- Keep all teaching content, examples and relevant questions with their answers.

**Pacing**
- Natural; only remove pauses longer than a breath.

**Structure**
- Intro and agenda → topics in order → Q&A (relevant questions only) → summary.
- A chapter for every topic so viewers can jump around.

**On-screen text**
- Topic titles at each chapter; key terms as callouts.
"#,
        ),
        preset(
            "story",
            "Documentary / storytelling",
            "Long-form",
            "film",
            "Narrative videos: story arc first, atmosphere and pauses kept",
            "teal",
            0.9,
            8.0,
            0.0,
            "16:9",
            r#"
**Goal:** a compelling story with a clear arc: setup, tension, resolution.

**Hook**
- Open with the most intriguing moment or question of the story; it can come from the middle or end.

**What to cut**
- Retakes, digressions that don't move the story, repeated facts.
- Keep emotional moments and meaningful pauses; silence can be powerful here.

**Structure**
- Hook → setup (who, where, why it matters) → rising tension → turning point → resolution → reflection.
- Reorder sections if it makes the story stronger, but never misrepresent what was said.

**B-roll**
- Atmospheric shots, archival material and places mentioned; let visuals breathe.

**On-screen text**
- Dates, places and names as lower thirds; chapter titles as story beats.
"#,
        ),
        preset(
            "reaction",
            "Reaction / commentary",
            "YouTube",
            "message-square-quote",
            "Reacting to content: best reactions and opinions kept, dead air cut",
            "rose",
            0.4,
            0.0,
            0.0,
            "16:9",
            r#"
**Goal:** the creator's personality and opinions carry the video.

**Hook**
- Open with the strongest reaction or hottest take.

**What to cut**
- Long stretches of silent watching, repeated reactions, pausing/scrubbing, "wait let me go back".
- Keep genuine reactions, jokes and the reasoning behind opinions.

**Structure**
- Hook → what we're reacting to → reactions in order → final verdict/opinion → CTA.

**On-screen text**
- Context callouts ("Part 2", rating, quotes being reacted to).
"#,
        ),
        preset(
            "promo",
            "Business / promo / ad",
            "Short-form",
            "megaphone",
            "Brand, product and service promos: 30–90 s, benefit-led, clear CTA",
            "yellow",
            0.25,
            4.0,
            75.0,
            "16:9",
            r#"
**Goal:** a short promo that makes the offer clear and drives one action.

**Hook (first 3 s)**
- Lead with the customer's problem or the main benefit.

**What to cut**
- Everything that isn't the problem, the solution, proof or the call to action. Under 90 seconds.
- Retakes, filler, hedging language, long company history.

**Structure**
- Problem → solution/offer → 2–3 benefits or proof (testimonial, number, demo) → clear call to action.

**B-roll**
- Product/service in use, happy customers, location, results. Frequent.

**On-screen text**
- Benefits as short callouts, the offer/price and the CTA (website, phone, "Book now") at the end.
"#,
        ),
    ]
}

fn user_style_path(id: &str) -> std::path::PathBuf {
    util::styles_dir().join(format!("{id}.json"))
}

pub fn list() -> Vec<Style> {
    let mut out = builtins();
    if let Ok(rd) = std::fs::read_dir(util::styles_dir()) {
        let mut user: Vec<Style> = rd
            .flatten()
            .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
            .filter_map(|e| util::read_json::<Style>(&e.path()).ok())
            .collect();
        user.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        for s in user {
            // A saved copy of a built-in overrides it in place.
            if let Some(slot) = out.iter_mut().find(|b| b.id == s.id) {
                *slot = Style { builtin: true, ..s };
            } else {
                out.push(Style { builtin: false, ..s });
            }
        }
    }
    out
}

pub fn get(id: &str) -> Style {
    let all = list();
    all.iter().find(|s| s.id == id).cloned().unwrap_or_else(|| all[0].clone())
}

pub fn save(mut s: Style) -> Result<Style> {
    if s.name.trim().is_empty() {
        bail!("give the style a name");
    }
    if s.id.trim().is_empty() {
        s.id = format!("style-{}", util::new_id());
    }
    s.pause_keep = s.pause_keep.clamp(0.1, 2.0);
    s.broll_every = s.broll_every.clamp(0.0, 120.0);
    s.updated = util::now_iso();
    util::write_json(&user_style_path(&s.id), &s)?;
    Ok(get(&s.id))
}

/// Deletes a user style, or resets a built-in to its defaults.
pub fn delete(id: &str) -> Result<()> {
    let p = user_style_path(id);
    if p.exists() {
        std::fs::remove_file(p)?;
    }
    Ok(())
}
