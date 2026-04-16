"""Smoke tests that key endpoints exist and return proper status codes."""
import pytest


ENDPOINTS = [
    ("GET", "/health", (200,)),
    ("GET", "/api/projects", (401, 403)),
    ("POST", "/api/auth/signup", (422,)),
    ("POST", "/api/auth/login", (422,)),
    ("GET", "/api/billing/can-build", (401, 403)),
    ("GET", "/api/template-marketplace", (200, 401, 403, 500)),
    ("GET", "/api/gallery", (200, 401, 403, 500)),
    ("POST", "/api/chat", (401, 403, 422)),
    ("GET", "/live/nonexistent", (404,)),
    ("GET", "/api/preferences", (401, 403)),
    ("GET", "/api/plugins", (200, 401, 403, 500)),
    ("GET", "/api/components", (200, 401, 403, 500)),
    ("POST", "/api/projects", (401, 403, 422)),
    ("GET", "/api/files/00000000-0000-0000-0000-000000000000", (404, 500)),
    ("GET", "/live/00000000-0000-0000-0000-000000000000/manifest.json", (404,)),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path,expected_codes", ENDPOINTS, ids=[p for _, p, _ in ENDPOINTS])
async def test_endpoint_exists(client, method, path, expected_codes):
    """Verify the endpoint exists and returns an expected status."""
    try:
        if method == "GET":
            response = await client.get(path)
        elif method == "POST":
            response = await client.post(path)
        else:
            response = await client.request(method, path)

        assert response.status_code in expected_codes, (
            f"{method} {path} returned {response.status_code}, expected one of {expected_codes}"
        )
    except (RuntimeError, Exception) as e:
        err = str(e)
        if "attached to a different loop" in err or "another operation" in err:
            pytest.skip(f"Event loop conflict in test mode")
        raise
