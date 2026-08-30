// The narrative contract, lifted from src/content.config.ts.
// These three fields are what make every project page answer the same questions.

const contract = z.object({
  /** What was actually wrong or needed. Not "I built an X". */
  problem: z.string(),

  /** What was non-obvious here — the judgement call, constraint, or trick. */
  unique: z.string(),

  /** Concrete takeaways. At least one, or the build fails. */
  learned: z.array(z.string()).min(1),
});

// Because these are required rather than conventional, a write-up that skips
// the thinking cannot be published. The build is the editor.
