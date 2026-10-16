"""Tests for PII Masker and Scanner (FR-24)."""

from src.tools.pii import PIIMasker


def test_mask_email():
    """Verify email masking preserves first letter and full domain."""
    assert PIIMasker.mask_email("john.doe@example.com") == "j***@example.com"
    assert PIIMasker.mask_email("a@b.com") == "*@b.com"
    assert PIIMasker.mask_email("invalid-email") == "***MASKED_EMAIL***"


def test_mask_indonesian_phone():
    """Verify Indonesian phone numbers are masked properly."""
    assert PIIMasker.mask_phone("+6281234567890") == "+6281****7890"
    assert PIIMasker.mask_phone("081234567890") == "08123****7890"
    assert PIIMasker.mask_phone("123") == "***MASKED_PHONE***"


def test_mask_free_text():
    """Verify scanning and masking across multi-line free-form text."""
    text = (
        "Pelanggan dengan email contact.buyer@ecommerce.id dan nomor telepon "
        "+6281234567890 telah melakukan pembayaran menggunakan kartu kredit 4111 2222 3333 4444."
    )
    masked = PIIMasker.mask_text(text)
    assert "contact.buyer@ecommerce.id" not in masked
    assert "c***@ecommerce.id" in masked
    assert "+6281234567890" not in masked
    assert "+6281****7890" in masked
    assert "4111 2222 3333 4444" not in masked
    assert "****-****-****-****" in masked


def test_mask_record():
    """Verify dictionary fields matching sensitive keys are masked."""
    record = {
        "customer_id": "cust_12345",
        "name": "Budi Santoso",
        "email": "budi.santoso@gmail.com",
        "phone_number": "081987654321",
        "password": "supersecretpassword",
        "total_spend": 1500000.0,
    }
    masked = PIIMasker.mask_record(record)
    assert masked["customer_id"] == "cust_12345"
    assert masked["name"] == "Budi Santoso"
    assert masked["email"] == "b***@gmail.com"
    assert masked["phone_number"] == "***MASKED_PII***"
    assert masked["password"] == "***MASKED_PII***"
    assert masked["total_spend"] == 1500000.0
