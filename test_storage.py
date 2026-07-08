import urllib.request
import urllib.error
import json

SRK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTg1MjExMywiZXhwIjoyMDk3MjEyMTEzfQ.AJblY9T0wlpIjvD_oZ_1qJXW0NKELZTVCs5V3KQs26I"

# Test: Storage API upload via Kong (54322)
print("=== Test: Storage API upload via Kong ===")
req = urllib.request.Request(
    "http://localhost:54322/storage/v1/object/private/test-final-fix.txt",
    data=b"test content - final fix",
    headers={
        "apikey": SRK,
        "Authorization": f"Bearer {SRK}",
        "Content-Type": "text/plain"
    },
    method="POST"
)
try:
    resp = urllib.request.urlopen(req)
    print(f"SUCCESS: {resp.status} {resp.read().decode()}")
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"FAILED: {e.code}")
    print(f"Body: {body[:500]}")
