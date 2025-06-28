FROM node:20
WORKDIR /app
COPY package.json .
RUN npm install
COPY detector.js .
COPY mitm_script.py ml_model.py tasks.py main.py payment_classifier.joblib .
COPY requirements.txt .
RUN pip install -r requirements.txt
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
