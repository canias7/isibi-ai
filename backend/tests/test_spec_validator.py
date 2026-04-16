from generator.spec_validator import validate_and_repair, get_validation_report


def test_empty_spec_gets_defaults():
    spec = {}
    fixed = validate_and_repair(spec)
    assert "app_name" in fixed
    assert "entities" in fixed
    assert "modules" in fixed
    assert "design_system" in fixed


def test_entity_gets_system_fields():
    spec = {"entities": [{"name": "Lead", "fields": [{"name": "email", "db_type": "VARCHAR(255)"}]}]}
    fixed = validate_and_repair(spec)
    field_names = [f["name"] for f in fixed["entities"][0]["fields"]]
    assert "id" in field_names
    assert "org_id" in field_names
    assert "created_at" in field_names


def test_missing_table_name_generated():
    spec = {"entities": [{"name": "SalesLead", "fields": []}]}
    fixed = validate_and_repair(spec)
    assert fixed["entities"][0]["table"] == "sales_leads"


def test_validation_report():
    spec = {"entities": [{"name": "Test"}]}
    issues = get_validation_report(spec)
    assert len(issues) > 0
