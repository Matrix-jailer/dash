from mitmproxy import http
import re
import redis
import json
import os

redis_client = redis.Redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379/0'))

STRIPE_URLS = [re.compile(r'\bjs\.stripe\.com\b'), re.compile(r'\bapi\.stripe\.com\b'), re.compile(r'\bcheckout\.stripe\.com\b')]
PAYPAL_URLS = [re.compile(r'\b(paypal\.com|sdk\.paypal\.com|api(-m)?\.paypal\.com|paypalobjects\.com)\b')]
CF_URLS = [re.compile(r'\b(cloudflare\.com|cdn\.cloudflare\.com|challenges\.cloudflare\.com)\b')]
CAPTCHA_URLS = [re.compile(r'\b(recaptcha\/api|google\.com\/recaptcha|hcaptcha\.com)\b')]
THREE_DS_URLS = [re.compile(r'\b(3ds|acs_url|verifiedbyvisa|mastercard\.securecode|acs\.stripe\.com)\b')]
IGNORE_URLS = [re.compile(r'\.(css|js|png|jpg|jpeg|gif|woff2?|ttf|svg|ico)$'), re.compile(r'\b(usercentrics\.eu|onetrust\.com|google-analytics\.com|facebook\.com|adservice\.google\.com)\b')]

class PaymentDetector:
    def __init__(self):
        self.results = {'gateways': set(), 'cf': False, 'captcha': False, 'three_ds': False, 'urls': set()}
    
    def request(self, flow: http.HTTPFlow):
        url = flow.request.url
        job_id = flow.request.query.get('job_id')
        if not job_id:
            return
        if any(ig.search(url) for ig in IGNORE_URLS):
            return
        if any(p.search(url) for p in STRIPE_URLS):
            self.results['gateways'].add('Stripe')
            self.results['urls'].add(url)
        if any(p.search(url) for p in PAYPAL_URLS):
            self.results['gateways'].add('PayPal')
            self.results['urls'].add(url)
        if any(p.search(url) for p in CF_URLS):
            self.results['cf'] = True
        if any(p.search(url) for p in CAPTCHA_URLS):
            self.results['captcha'] = True
        if any(p.search(url) for p in THREE_DS_URLS):
            self.results['three_ds'] = True
        redis_client.set(job_id, json.dumps({**self.results, 'gateways': list(self.results['gateways'])}))

addons = [PaymentDetector()]