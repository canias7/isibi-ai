from generator.spec_validator import validate_and_repair


def test_duplicate_fields_removed():
    spec = {"entities": [{"name": "Test", "fields": [
        {"name": "email", "db_type": "VARCHAR(255)"},
        {"name": "email", "db_type": "VARCHAR(255)"}
    ]}]}
    fixed = validate_and_repair(spec)
    names = [f["name"] for f in fixed["entities"][0]["fields"]]
    assert names.count("email") == 1


def test_enum_gets_badge_colors():
    spec = {"entities": [{"name": "Lead", "fields": [
        {"name": "status", "db_type": "VARCHAR(50)", "enum_values": ["new", "active", "closed"]}
    ]}]}
    fixed = validate_and_repair(spec)
    status = next(f for f in fixed["entities"][0]["fields"] if f["name"] == "status")
    assert "badge_colors" in status


def test_email_gets_validation():
    spec = {"entities": [{"name": "Contact", "fields": [
        {"name": "email", "db_type": "VARCHAR(255) NOT NULL"}
    ]}]}
    fixed = validate_and_repair(spec)
    email = next(f for f in fixed["entities"][0]["fields"] if f["name"] == "email")
    assert "validation" in email


def test_reserved_table_name_fixed():
    spec = {"entities": [{"name": "User", "table": "users", "fields": []}]}
    fixed = validate_and_repair(spec)
    assert fixed["entities"][0]["table"] != "users"  # should be prefixed


def test_modules_auto_generated():
    spec = {"entities": [{"name": "Lead", "fields": [{"name": "name"}]}]}
    fixed = validate_and_repair(spec)
    assert len(fixed["modules"]) >= 2  # Dashboard + Lead
