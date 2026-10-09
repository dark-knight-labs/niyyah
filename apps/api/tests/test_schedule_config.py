import pytest

S = "/api/v1/vault/schedule"
C = "/api/v1/vault/config/schedule"
META = {"city": "Leeds", "lat": 53.8, "lon": -1.55, "tz": "Europe/London", "method": "mwl", "madhab": "hanafi", "weekend_days": ["sat", "sun"]}
ROW = {"block": "soul", "start": "fajr", "end": "sunrise", "what": "Quran", "stream": None}


@pytest.mark.asyncio
async def test_save_then_read_back(db_client):
    client, _ = db_client
    res = await client.put(C, json={"meta": META, "weekday": [ROW, {**ROW, "block": "ot", "start": "08:30", "end": "dhuhr-10", "stream": "studio"}], "weekend": [ROW]})
    assert res.status_code == 200
    body = (await client.get(S)).json()
    assert body["meta"]["city"] == "Leeds" and body["meta"]["weekend_days"] == ["sat", "sun"]
    assert [r["block"] for r in body["days"]["weekday"]] == ["soul", "ot"] and body["days"]["weekday"][1]["stream"] == "studio"


@pytest.mark.asyncio
async def test_validation(db_client):
    client, _ = db_client
    def put(**over):
        payload = {"meta": META, "weekday": [ROW], "weekend": [ROW]}
        payload.update(over)
        return client.put(C, json=payload)
    cases = [
        ({"weekday": [{**ROW, "start": "25:00"}]}, "time"),
        ({"weekday": [{**ROW, "block": "nope"}]}, "block"),
        ({"weekday": [{**ROW, "stream": "ghost"}]}, "stream"),
        ({"weekday": []}, "weekday"),
        ({"meta": {**META, "lat": 123}}, "latitude"),
        ({"meta": {**META, "tz": "Mars/Base"}}, "time zone"),
        ({"meta": {**META, "method": "astrology"}}, "method"),
        ({"meta": {**META, "weekend_days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]}}, "weekend"),
        ({"meta": {**META, "weekend_days": ["funday"]}}, "weekend"),
    ]
    for over, word in cases:
        res = await put(**over)
        assert res.status_code == 422 and word in res.json()["detail"].lower(), (over, res.text)
    assert (await put(meta={**META, "lat": None, "lon": None})).status_code == 200  # a new account may not have a location yet
    assert (await put(meta={**META, "lat": 10, "lon": None})).status_code == 422
