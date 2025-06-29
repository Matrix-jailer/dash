import os
from fastapi import FastAPI, BackgroundTasks
import redis
import uuid
import json
from tasks import scan_website

app = FastAPI()
redis_client = redis.Redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379/0'))

@app.get("/gateway")
async def scan(url: str, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    background_tasks.add_task(scan_website, url, job_id)
    return {"job_id": job_id, "status": "pending"}

@app.get("/results/{job_id}")
async def get_results(job_id: str):
    result = redis_client.get(job_id)
    return json.loads(result) if result else {"status": "pending"}
