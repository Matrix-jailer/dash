 import re

class MLDetector:
    def __init__(self):
        # Placeholder: Replace with actual model loading
        self.model = lambda x: True  # Assume model exists

    def predict(self, content):
        # Fallback heuristic for demo
        if re.search(r'card[number|no|num]|payment_intent|client_secret', content, re.IGNORECASE):
            return True
        return False  # Replace with self.model.predict([content])[0] when model is available
