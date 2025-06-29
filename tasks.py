import os
from celery import Celery
import redis
import json
import subprocess

app = Celery('tasks', broker=os.getenv('REDIS_URL', 'redis://localhost:6379/0'))
redis_client = redis.Redis.from_url(os.getenv('REDIS_URL'))

@app.task
def scan_website(url, job_id):
    result = subprocess.run(['node', 'detector.js', url, job_id], capture_output=True, text=True)
    redis_client.set(job_id, result.stdout)
    return json.loads(result.stdout)
