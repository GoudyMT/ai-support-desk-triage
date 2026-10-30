"""The word-weight (TF-IDF) features, fixed so the TypeScript scorer can reproduce them."""

from sklearn.feature_extraction.text import TfidfVectorizer

# ASCII word characters only. Without (?a), Python reads "caf" + e-acute as one
# word while the TypeScript scorer, using plain [a-z0-9_], would split it.
TOKEN_PATTERN = r"(?a)\b\w\w+\b"


def make_vectorizer():
    """Builds the vectorizer both heads use.

    Returns:
        An unfitted TfidfVectorizer: lower case, one and two word phrases,
        phrases seen in fewer than two tickets dropped, repeats weighed as
        1 + ln(count), rows scaled to length 1.
    """
    return TfidfVectorizer(
        lowercase=True,
        token_pattern=TOKEN_PATTERN,
        ngram_range=(1, 2),
        min_df=2,
        sublinear_tf=True,
        norm="l2",
        smooth_idf=True,
    )
