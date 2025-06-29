import os
import json
import subprocess
import redis
from celery import Celery

# Setup Celery with Redis broker
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
app = Celery('tasks', broker=redis_url)

# Setup Redis client
try:
    redis_client = redis.Redis.from_url(redis_url)
    redis_client.ping()
except redis.ConnectionError as e:
    print(f"❌ Redis connection failed: {e}")
    redis_client = None  # Avoid crashing on connection failure

@app.task
def scan_website(url, job_id):
    try:
        result = subprocess.run(
            ['node', 'detector.js', url, job_id],
            capture_output=True,
            text=True,
            check=True
        )
        output = result.stdout.strip()

        # Save to Redis if available
        if redis_client:
            redis_client.set(job_id, output)

        return json.loads(output)
    
    except subprocess.CalledProcessError as e:
        error_message = f"⚠️ detector.js failed: {e.stderr or e}"
        print(error_message)
        if redis_client:
            redis_client.set(job_id, json.dumps({"error": error_message}))
        return {"error": error_message}
    
    except json.JSONDecodeError:
        error_message = "❌ detector.js did not return valid JSON."
        print(error_message)
        if redis_client:
            redis_client.set(job_id, json.dumps({"error": error_message}))
        return {"error": error_message}
