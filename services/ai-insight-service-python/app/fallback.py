import re

POSITIVE_WORDS = {"great", "good", "excellent", "amazing", "loved", "friendly", "clean"}
NEGATIVE_WORDS = {"bad", "terrible", "rude", "cold", "dirty", "worst", "awful"}

_WORD_RE = re.compile(r"[a-z']+")


def rule_based_analysis(text: str) -> dict:
    """A deliberately simple fallback so the service has a real, working
    contract even before a team wires up the actual model. Replace or
    extend this once Ollama is integrated -- see docs/BONUS.md."""
    # Splitting on whitespace alone keeps punctuation attached, so "amazing!"
    # or "great," never matched the word lists and scored neutral.
    words = set(_WORD_RE.findall(text.lower()))
    pos = len(words & POSITIVE_WORDS)
    neg = len(words & NEGATIVE_WORDS)
    if pos > neg:
        sentiment = "positive"
    elif neg > pos:
        sentiment = "negative"
    else:
        sentiment = "neutral"
    summary = text.strip()[:80] + ("..." if len(text.strip()) > 80 else "")
    return {"sentiment": sentiment, "summary": summary}
