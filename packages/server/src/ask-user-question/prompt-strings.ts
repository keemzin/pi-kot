export const TOOL_DESCRIPTION =
  "Present a structured question to the user with predefined options. " +
  "Use this when you need the user to make a choice or provide input " +
  "before continuing. Supports single-select, multi-select, and " +
  "free-text custom input.";

export const PROMPT_SNIPPET =
  "\n- Use `ask_user_question` to ask the user questions when you need " +
  "their input, choices, or decisions.\n";

export const PROMPT_GUIDELINES =
  "## Asking the user questions\n\n" +
  "You can use `ask_user_question` to ask the user structured questions " +
  "when you need their input. Each question can have multiple options. " +
  "The user can select one option, type a custom answer, or choose to " +
  "chat about it instead.\n\n" +
  "Guidelines:\n" +
  "- Use this when you're blocked and need user input\n" +
  "- Provide clear, descriptive options\n" +
  "- Keep headers short (16 chars max)\n" +
  "- You can ask up to 4 questions at once\n" +
  "- Each question needs between 2-4 options\n";
