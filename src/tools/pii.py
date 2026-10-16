"""PII (Personally Identifiable Information) Masker and Scanner (FR-24)."""

import re
from typing import Any

# Regex patterns for common sensitive identifiers
EMAIL_REGEX = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b")
PHONE_REGEX = re.compile(r"(\+?62|0)8[1-9][0-9]{6,10}\b")
CREDIT_CARD_REGEX = re.compile(r"\b(?:\d{4}[ -]?){3}\d{4}\b")

# Sensitive column names
SENSITIVE_FIELD_NAMES = {
    "email", "phone_number", "phone", "telepon", "password", 
    "credit_card", "card_number", "nik", "ktp", "ssn", "secret"
}


class PIIMasker:
    """Comprehensive PII detection and masking engine."""

    @classmethod
    def mask_email(cls, email: str) -> str:
        """Mask email preserving first char and domain: j***@example.com."""
        parts = email.split("@")
        if len(parts) != 2:
            return "***MASKED_EMAIL***"
        local_part, domain = parts
        if len(local_part) <= 1:
            masked_local = "*"
        else:
            masked_local = local_part[0] + "***"
        return f"{masked_local}@{domain}"

    @classmethod
    def mask_phone(cls, phone: str) -> str:
        """Mask phone number preserving prefix and last 4 digits: +62812****7890."""
        clean_phone = re.sub(r"[\s-]", "", phone)
        if len(clean_phone) <= 6:
            return "***MASKED_PHONE***"
        prefix = clean_phone[:5]
        suffix = clean_phone[-4:]
        return f"{prefix}****{suffix}"

    @classmethod
    def mask_text(cls, text: str) -> str:
        """Scan free-form text and mask all found PII instances."""
        if not text:
            return text

        # 1. Mask Emails
        def _replace_email(match):
            return cls.mask_email(match.group(0))
        masked = EMAIL_REGEX.sub(_replace_email, text)

        # 2. Mask Phone Numbers
        def _replace_phone(match):
            return cls.mask_phone(match.group(0))
        masked = PHONE_REGEX.sub(_replace_phone, masked)

        # 3. Mask Credit Cards
        masked = CREDIT_CARD_REGEX.sub("****-****-****-****", masked)

        return masked

    @classmethod
    def mask_record(cls, record: dict[str, Any]) -> dict[str, Any]:
        """Mask dictionary fields matching sensitive column names or values."""
        masked_dict = {}
        for k, v in record.items():
            k_lower = str(k).lower()
            if k_lower in SENSITIVE_FIELD_NAMES:
                if isinstance(v, str):
                    if "@" in v:
                        masked_dict[k] = cls.mask_email(v)
                    else:
                        masked_dict[k] = "***MASKED_PII***"
                else:
                    masked_dict[k] = "***MASKED_PII***"
            elif isinstance(v, str):
                masked_dict[k] = cls.mask_text(v)
            else:
                masked_dict[k] = v
        return masked_dict
