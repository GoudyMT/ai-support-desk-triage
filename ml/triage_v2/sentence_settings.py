"""The sentence model's training settings, kept apart from the training code so CI can read them without torch."""

RANDOM_STATE = 113
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
# The exact published version the bundle was trained from. A bare name follows
# whatever its publisher uploads next; a version id does not.
BASE_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
FIELDS = ("category", "priority")
# A third answer a model may be trained to give: whether a person must see the ticket.
REVIEW_FIELD = "mustReview"
EPOCHS = 2
LEARNING_RATE = 2e-5
BATCH_SIZE = 64
MAX_LENGTH = 256
