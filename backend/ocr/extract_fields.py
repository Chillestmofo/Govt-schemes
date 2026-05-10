"""
Field extraction from OCR text for government documents.
Extracts structured data from PAN, Aadhaar, Caste Certificate, Income Certificate.
"""

import re
import logging
from datetime import datetime
from typing import Dict, Optional, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)


# -------------------------
# GARBAGE WORD FILTER
# -------------------------
GARBAGE_WORDS = {
    'AAT', 'WET', 'WY', 'THE', 'OF', 'AND', 'IS', 'TO', 'IN', 'AT', 'ON',
    'FOR', 'BY', 'AN', 'AS', 'OR', 'IT', 'BE', 'IF', 'SO', 'NO', 'UP',
    'GOVERNMENT', 'INDIA', 'STATE', 'CERTIFICATE', 'CERTIFY', 'THAT',
    'THIS', 'DATE', 'BIRTH', 'PERMANENT', 'ADDRESS', 'INCOME', 'CASTE',
    'NAME', 'DOB', 'SON', 'DAUGHTER', 'WIFE', 'FATHER', 'MOTHER',
    'MALE', 'FEMALE', 'YEAR', 'OLD', 'AGE', 'RESIDENT', 'VILLAGE',
    'DISTRICT', 'TALUK', 'MANDAL', 'NUMBER', 'AADHAAR', 'PAN', 'UID',
    'VID', 'ISSUE', 'VALID', 'FROM', 'TILL', 'HEREBY', 'CERTIFIED',
    'TAX', 'DEPARTMENT', 'ACCOUNT', 'REPUBLIC', 'SIGNED', 'ISSUING',
    'AUTHORITY', 'SIGNATURE', 'GOVT', 'CARD', 'UNIQUE', 'IDENTIFICATION',
    'SOT', 'UNK', 'HEALEY', 'FERFSA', 'QRS', 'XYZ', 'ABC', 'DEF', 'GHI'
}


@dataclass
class ExtractedFields:
    """Structured fields extracted from document."""
    document_type: str
    name: Optional[str] = None
    date_of_birth: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    category: Optional[str] = None
    annual_income: Optional[int] = None
    pan_number: Optional[str] = None
    aadhaar_number: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    area_type: Optional[str] = None
    raw_text: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "document_type": self.document_type,
            "name": self.name,
            "date_of_birth": self.date_of_birth,
            "age": self.age,
            "gender": self.gender,
            "category": self.category,
            "annual_income": self.annual_income,
            "pan_number": self.pan_number,
            "aadhaar_number": self.aadhaar_number,
            "state": self.state,
            "city": self.city,
            "area_type": self.area_type,
            "raw_text": self.raw_text[:500] if self.raw_text else ""
        }


def normalize_text(text: str) -> str:
    """Normalize text for easier pattern matching."""
    text = text.upper()
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def is_valid_name_word(word: str) -> bool:
    """Check if a word looks like a valid name component."""
    if not word.isalpha():
        return False
    if len(word) < 3:
        return False
    if word in GARBAGE_WORDS:
        return False
    vowels = set('AEIOU')
    if not any(c in vowels for c in word):
        return False
    return True


def clean_name(name: str) -> Optional[str]:
    """Clean extracted name by filtering out garbage words."""
    if not name:
        return None
    words = name.strip().split()
    valid_words = [w for w in words if is_valid_name_word(w)]
    if len(valid_words) >= 2:
        return ' '.join(valid_words[:4]).title()
    elif len(valid_words) == 1 and len(valid_words[0]) > 4:
        return valid_words[0].title()
    return None


def detect_document_type(text: str) -> str:
    """Detect the type of government document from OCR text."""
    normalized = normalize_text(text)
    
    if "PERMANENT ACCOUNT NUMBER" in normalized or "INCOME TAX DEPARTMENT" in normalized:
        return "PAN Card"
    if re.search(r'\b\d{4}\s*\d{4}\s*\d{4}\b', normalized) or 'AADHAAR' in normalized or 'UIDAI' in normalized or 'आधार' in text:
        return "Aadhaar Card"
    if ("CASTE CERTIFICATE" in normalized or "SCHEDULED CASTE" in normalized 
            or "SCHEDULED TRIBE" in normalized or "OBC" in normalized
            or "OTHER BACKWARD" in normalized or "पिछड़ी जाति" in text
            or "जाति प्रमाण" in text or "BACKWARD CLASS" in normalized):
        return "Caste Certificate"
    if "INCOME CERTIFICATE" in normalized:
        return "Income Certificate"
    return "Unknown Document"


def extract_name(text: str) -> Optional[str]:
    """Extract name from document text using multiple strategies."""
    normalized = normalize_text(text)
    lines = text.upper().split('\n') if '\n' in text else [normalized]
    
    # Strategy 1: Look for line after "NAME" label
    for i, line in enumerate(lines):
        if re.search(r'\bNAME\b', line):
            # Check the same line after NAME
            after_name = re.sub(r'.*\bNAME\b\s*[:/]?\s*', '', line)
            name = clean_name(after_name)
            if name:
                logger.info(f"Extracted name (after NAME label): {name}")
                return name
            # Check the next line
            if i + 1 < len(lines):
                name = clean_name(lines[i + 1])
                if name:
                    logger.info(f"Extracted name (next line after NAME): {name}")
                    return name
    
    # Strategy 2: Look for "NAME:" followed by the actual name
    match = re.search(r'NAME\s*[:\-/]?\s*([A-Z][A-Z\s]{2,50}?)(?=\s*(?:S/O|D/O|W/O|DOB|DATE|MALE|FEMALE|FATHER|\d|$))', normalized)
    if match:
        name = clean_name(match.group(1))
        if name:
            logger.info(f"Extracted name (pattern 2): {name}")
            return name

    # Strategy 3: Look for name after common prefixes
    match = re.search(r'(?:SHRI|SMT|KUM|MR|MRS|MS)\.?\s+([A-Z][A-Z\s]{2,50}?)(?=\s*(?:S/O|D/O|W/O|DOB|DATE|MALE|FEMALE|FATHER|AGE|\d|$))', normalized)
    if match:
        name = clean_name(match.group(1))
        if name:
            logger.info(f"Extracted name (pattern 3): {name}")
            return name

    # Strategy 4: Extract consecutive valid name words (fallback)
    tokens = normalized.split()
    name_tokens = []
    
    for token in tokens:
        if is_valid_name_word(token):
            name_tokens.append(token)
        else:
            if len(name_tokens) >= 2:
                break
            name_tokens = []

    if len(name_tokens) >= 2:
        name = ' '.join(name_tokens).title()
        logger.info(f"Extracted name (fallback): {name}")
        return name

    return None


def extract_dob(text: str) -> Optional[str]:
    """Extract date of birth from document text."""
    # Step 1: Aggressively clean OCR noise before anything else
    # Replace letter O with 0, l with 1, pipe/space between numbers, etc.
    cleaned = text
    cleaned = re.sub(r'(?<=[0-9])\s*[|]\s*(?=[0-9])', '/', cleaned)  # '02 |03' -> '02/03'
    cleaned = re.sub(r'(?<=[0-9])\s*[|]\s*(?=[0-9])', '/', cleaned)  # run twice for safety
    cleaned = cleaned.replace('O', '0').replace('o', '0')  # OCR letter O -> 0
    cleaned = re.sub(r'(?<=[0-9])\s+(?=[0-9])', '', cleaned)  # remove spaces between digits
    normalized = normalize_text(cleaned)
    
    # Pattern 1: With label (DATE OF BIRTH, DOB)
    match = re.search(
        r'(?:DATE\s*OF\s*BIRTH|DOB|D\.O\.B|तिथि)\s*[:\-/]?\s*(\d{1,2}[\-/\.]\d{1,2}[\-/\.]\d{2,4})',
        normalized
    )
    if match:
        dob = match.group(1)
        logger.info(f"Extracted DOB (with label): {dob}")
        return dob
    
    # Pattern 2: Standalone date DD/MM/YYYY
    match = re.search(r'(\d{1,2}[\-/\.]\d{1,2}[\-/\.]\d{4})', normalized)
    if match:
        dob = match.group(1)
        logger.info(f"Extracted DOB (standalone): {dob}")
        return dob

    # Pattern 3: Flexible with spaces around separator - search on CLEANED text
    match = re.search(r'(\d{1,2})\s*[/|\-\.]\s*(\d{1,2})\s*[/|\-\.\s]\s*(\d{4})', cleaned)
    if match:
        dob = f"{match.group(1)}/{match.group(2)}/{match.group(3)}"
        logger.info(f"Extracted DOB (flexible): {dob}")
        return dob

    # Pattern 4: Year-only fallback — look for a 4-digit year near DOB keyword
    match = re.search(r'(?:DOB|D\.O\.B|तिथि).{0,30}?((?:19|20)\d{2})', cleaned, re.IGNORECASE)
    if match:
        year_str = match.group(1)
        year = int(year_str)
        if 1920 < year < 2020:
            logger.info(f"Extracted birth year only (fallback): {year}")
            return f"01/01/{year}"  # approximate DOB
    
    return None


def calculate_age(dob_string: str) -> Optional[int]:
    """Calculate age from date of birth string."""
    if not dob_string:
        return None
    
    date_formats = [
        '%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y',
        '%d/%m/%y', '%d-%m-%y', '%d.%m.%y'
    ]
    
    for fmt in date_formats:
        try:
            birth_date = datetime.strptime(dob_string, fmt)
            if birth_date.year > datetime.now().year:
                birth_date = birth_date.replace(year=birth_date.year - 100)
            
            today = datetime.now()
            age = today.year - birth_date.year
            
            if (today.month, today.day) < (birth_date.month, birth_date.day):
                age -= 1
            
            return age
        except ValueError:
            continue
    
    return None


def extract_gender(text: str) -> Optional[str]:
    """Extract gender from document text."""
    normalized = normalize_text(text)
    
    if re.search(r'[/\s]MALE\b', normalized) or 'पुरुष' in text:
        return 'male'
    elif re.search(r'[/\s]FEMALE\b', normalized) or 'महिला' in text or 'स्त्री' in text:
        return 'female'
    elif re.search(r'\bMALE\b', normalized):
        return 'male'
    elif re.search(r'\bFEMALE\b', normalized):
        return 'female'
    
    return None


def extract_category(text: str) -> Optional[str]:
    """Extract social category from document text - supports Aadhaar, Caste Certificates, etc."""
    normalized = normalize_text(text)
    
    # ST checks (before SC to avoid partial match)
    if re.search(r'SCHEDULED\s+TRI', normalized) or 'अनुसूचित जनजाति' in text:
        return 'st'
    # SC checks
    if re.search(r'SCHEDULED\s+CAS', normalized) or 'अनुसूचित जाति' in text:
        return 'sc'
    # OBC checks - English
    if 'OBC' in normalized or 'OTHER BACKWARD' in normalized or 'BACKWARD CLASS' in normalized:
        return 'obc'
    # OBC checks - Hindi (Caste Certificate uses 'पिछड़ी जाति' or 'पिछड़े वर्ग')
    if 'पिछड़ी जाति' in text or 'पिछड़े वर्ग' in text or 'पिछड़ा वर्ग' in text:
        return 'obc'
    # General
    if 'GENERAL' in normalized or 'UNRESERVED' in normalized:
        return 'general'
    
    return None


def extract_income(text: str) -> Optional[int]:
    """Extract annual income from document text."""
    normalized = normalize_text(text)
    
    match = re.search(r'INCOME\s*(IS|OF)?\s*[:\-]?\s*RS\.?\s*(\d{3,})', normalized)
    if match:
        return int(match.group(2))

    match = re.search(r'INCOME\s*[:\-]?\s*(\d{3,})', normalized)
    if match:
        return int(match.group(1))

    return None


def extract_pan(text: str) -> Optional[str]:
    """Extract PAN number from document text."""
    match = re.search(r'\b([A-Z]{5}[0-9]{4}[A-Z])\b', text.upper())
    return match.group(1) if match else None


def extract_aadhaar(text: str) -> Optional[str]:
    """Extract Aadhaar number from document text."""
    match = re.search(r'\b(\d{4}\s+\d{4}\s+\d{4})\b', text)
    if match:
        return match.group(1)
    
    text_clean = re.sub(r'\s+', '', text)
    match = re.search(r'(\d{12})', text_clean)
    if match:
        aadhaar = match.group(1)
        return f"{aadhaar[:4]} {aadhaar[4:8]} {aadhaar[8:12]}"
    return None


def extract_fields_from_text(text: str) -> ExtractedFields:
    """
    Extract all relevant fields from OCR text using Groq LLM.
    """
    logger.info(f"OCR Raw Text (first 500 chars): {text[:500]}")
    
    doc_type = detect_document_type(text)
    logger.info(f"Detected document type: {doc_type}")
    
    fields = ExtractedFields(
        document_type=doc_type,
        raw_text=text
    )
    
    if not text.strip():
        return fields
        
    # ── Institutional Header Cleaner ────────────────────────────────
    institutional_patterns = [
        r'GOVERNMENT\s+OF\s+INDIA', r'भारत\s+सरकार', 
        r'UNIQUE\s+IDENTIFICATION\s+AUTHORITY\s+OF\s+INDIA', r'भारतीय\s+विशिष्ट\s+पहचान\s+प्राधिकरण',
        r'INCOME\s+TAX\s+DEPARTMENT', r'आयकर\s+विभाग',
        r'E-AADHAAR', r'ELECTRONIC\s+AADHAAR', r'UIDAI', r'IRCTC'
    ]
    cleaned_raw_text = text
    for pattern in institutional_patterns:
        cleaned_raw_text = re.sub(pattern, '', cleaned_raw_text, flags=re.IGNORECASE)

    try:
        import openai
        import os
        import json
        
        client = openai.OpenAI(
            api_key=os.getenv("GROQ_API_KEY", "your_groq_api_key_here"),
            base_url="https://api.groq.com/openai/v1"
        )
        
        # ── Garbage name strings that the LLM sometimes returns ──────────
        NAME_BLACKLIST = {
            "government of india", "govt of india", "भारत सरकार",
            "unique identification authority of india", "uidai",
            "income tax department", "income tax dept",
            "caste certificate", "jati praman patra", "जाति प्रमाण पत्र",
            "income certificate", "आय प्रमाण पत्र",
            "backward class certificate", "obc certificate",
            "scheduled caste certificate", "scheduled tribe certificate",
            "uttar pradesh", "karnataka", "maharashtra", "andhra pradesh",
            "rajasthan", "bihar", "gujarat", "madhya pradesh",
            "state government", "राज्य सरकार", "irctc", "electronic aadhaar",
            "enrollment no", "enrolment no", "date of issue", "yojana"
        }

        def is_blacklisted_name(n: str) -> bool:
            if not n:
                return True
            n_lower = n.strip().lower()
            for bad in NAME_BLACKLIST:
                if bad in n_lower:
                    return True
            
            import re
            words = set(re.findall(r'\w+', n_lower))
            bad_keywords = {"government", "govt", "uidai", "irctc", "irciticia", "department", "authority", "identification", "certificate", "aadhaar", "praman", "patra", "yojana", "india", "state"}
            if words.intersection(bad_keywords):
                return True

            # Reject if it's only 1 word and all caps (likely a label or header)
            if len(n.strip().split()) == 1 and n.strip().isupper():
                return True
            # Reject if it contains numbers
            if any(char.isdigit() for char in n):
                return True
            return False

        prompt = f"""You are an expert OCR parser for Indian government documents.
Extract the following fields from the OCR text below and return ONLY a valid JSON object — no markdown, no explanation.

DOCUMENT TYPE DETECTED: {doc_type}

=== CRITICAL RULES FOR NAME EXTRACTION ===
The 'name' field must be the BENEFICIARY / APPLICANT's personal name (e.g. "RAHUL SHARMA"). 

FOR AADHAAR CARD:
- SKIP the first few lines like "Government of India" or "भारत सरकार".
- The name is usually on a single line by itself, right above the DOB line or Father's Name.
- It is a human name. NEVER return "Government of India", "UIDAI", "IRCTC", "irciticia", "India", or "E-Aadhaar" as a name.

FOR CASTE / INCOME CERTIFICATE:
- The name is the APPLICANT'S NAME, typically found near "प्रमाणित किया जाता है कि" or "Certified that".
- DO NOT extract names under "Digitally Signed by" or the signing authority (e.g., "PREM PAL SINGH").

=== LOCATION RULES ===
- state: 2-letter code (UP, KA, MH, etc.). Look for the state name in the address block. NEVER return 'government' or 'irctc'.
- city: Look for keywords like 'District', 'Dist', 'जिला' or the city name near the PIN code. NEVER return 'government' or 'irciticia'.

=== OTHER FIELDS ===
- age: integer. Calculate from year of birth.
- gender: 'male' or 'female'. 
- pan_number: 10-char PAN or null.
- aadhaar_number: 12-digit Aadhaar (XXXX XXXX XXXX) or null.
- category: 'obc', 'sc', 'st', or 'general'.
- annual_income: integer or null.

OCR TEXT:
{cleaned_raw_text[:2500]}
"""

        models_to_try = [
            "llama-3.3-70b-versatile",
            "llama3-70b-8192",
            "llama-3.1-8b-instant",
            "llama3-8b-8192"
        ]

        llm_content = None
        for model_name in models_to_try:
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                    response_format={"type": "json_object"}
                )
                llm_content = response.choices[0].message.content
                logger.info(f"OCR extraction used model: {model_name}")
                break
            except Exception as model_err:
                logger.warning(f"Model {model_name} failed: {model_err}, trying next model...")
                continue

        if not llm_content:
            raise Exception("All LLM models rate-limited or unavailable for OCR extraction")

        with open("ocr_debug.txt", "w") as f:
            f.write("RAW OCR TEXT:\n" + text + "\n\nPROMPT:\n" + prompt + "\n\nLLM RESPONSE:\n" + llm_content)

        result = json.loads(llm_content)

        fields.name = result.get("name")
        fields.age = result.get("age")
        fields.gender = result.get("gender")
        fields.pan_number = result.get("pan_number")
        fields.aadhaar_number = result.get("aadhaar_number")
        fields.category = result.get("category")
        fields.annual_income = result.get("annual_income")
        fields.state = result.get("state")
        fields.city = result.get("city")
        fields.area_type = result.get("area_type")

        # ── Strict Scoping for Certain Documents ────────────────────────
        if doc_type == 'Caste Certificate':
            # For caste certificates, we allow name, but ignore some PII
            fields.age = None
            fields.gender = None
            fields.pan_number = None
            fields.aadhaar_number = None
            fields.annual_income = None
            logger.info("Forced fields except name/category/location to None for Caste Certificate")
            
        elif doc_type == 'Income Certificate':
            # For income certificates, we allow name, but ignore some PII
            fields.age = None
            fields.gender = None
            fields.pan_number = None
            fields.aadhaar_number = None
            fields.category = None
            logger.info("Forced fields except name/income/location to None for Income Certificate")

        # ── Post-LLM sanity filter: reject garbage names ──────────────────
        if is_blacklisted_name(fields.name):
            logger.warning(f"LLM returned blacklisted name '{fields.name}', falling back to regex.")
            fields.name = None

        # ── PII Safety fallbacks (LLM sometimes refuses DOB/gender) ───────
        # Always prefer our regex DOB over LLM math hallucinations
        dob = extract_dob(text)
        if dob:
            calculated = calculate_age(dob)
            if calculated is not None:
                fields.age = calculated

        if not fields.gender:
            fields.gender = extract_gender(text)

        if not fields.name and doc_type not in ['Caste Certificate', 'Income Certificate']:
            regex_name = extract_name(text)
            if not is_blacklisted_name(regex_name):
                fields.name = regex_name

        # Regex fallback for state (also supports Hindi state names)
        if not fields.state:
            STATE_MAP = {
                'Andhra Pradesh': 'AP', 'Arunachal Pradesh': 'AR', 'Assam': 'AS',
                'Bihar': 'BR', 'Chhattisgarh': 'CG', 'Goa': 'GA', 'Gujarat': 'GJ',
                'Haryana': 'HR', 'Himachal Pradesh': 'HP', 'Jharkhand': 'JH',
                'Karnataka': 'KA', 'Kerala': 'KL', 'Madhya Pradesh': 'MP',
                'Maharashtra': 'MH', 'Manipur': 'MN', 'Meghalaya': 'ML',
                'Mizoram': 'MZ', 'Nagaland': 'NL', 'Odisha': 'OR',
                'Punjab': 'PB', 'Rajasthan': 'RJ', 'Sikkim': 'SK',
                'Tamil Nadu': 'TN', 'Telangana': 'TG', 'Tripura': 'TR',
                'Uttar Pradesh': 'UP', 'Uttarakhand': 'UK', 'West Bengal': 'WB',
                'Delhi': 'DL', 'Jammu and Kashmir': 'JK', 'Jammu & Kashmir': 'JK',
                'Ladakh': 'LA', 'Puducherry': 'PY', 'Chandigarh': 'CH',
                # Hindi names
                'उत्तर प्रदेश': 'UP', 'कर्नाटक': 'KA', 'महाराष्ट्र': 'MH',
                'गुजरात': 'GJ', 'राजस्थान': 'RJ', 'मध्य प्रदेश': 'MP',
                'बिहार': 'BR', 'दिल्ली': 'DL', 'पंजाब': 'PB',
            }
            for state_name, code in STATE_MAP.items():
                if state_name.lower() in text.lower():
                    fields.state = code
                    break
        
        # Regex fallback for area_type using Pincode overrides
        # 1. Look for a 6-digit pincode in the text
        extracted_pincode = None
        pincode_match = re.search(r'\b[1-9][0-9]{5}\b', text)
        if pincode_match:
            extracted_pincode = pincode_match.group(0)
            
        # 2. Load the urban pincodes dataset
        urban_pincodes = []
        try:
            with open(os.path.join(os.path.dirname(__file__), '..', 'data', 'urban_pincodes.json'), 'r') as f:
                urban_pincodes = json.load(f)
        except Exception as e:
            logger.warning(f"Could not load urban_pincodes.json: {e}")
            
        # 3. Override area_type based on pincode list
        if extracted_pincode:
            if extracted_pincode in urban_pincodes:
                fields.area_type = 'urban'
                logger.info(f"Pincode {extracted_pincode} found in urban list. Set to urban.")
            else:
                fields.area_type = 'rural'
                logger.info(f"Pincode {extracted_pincode} not in urban list. Set to rural.")
        elif not fields.area_type:
            # Original fallback if no pincode is found
            text_lower = text.lower()
            urban_keywords = ['sector', ' ward ', 'colony', 'nagar', 'estate', 'apartment', 'society', 'city']
            rural_keywords = ['village', 'gram', 'tehsil', 'block', 'taluka', 'mandal', 'vtc:', 'ग्राम', 'तहसील']
            if any(kw in text_lower for kw in rural_keywords):
                fields.area_type = 'rural'
            elif any(kw in text_lower for kw in urban_keywords):
                fields.area_type = 'urban'

        # Regex fallback for category
        if not fields.category:
            fields.category = extract_category(text)

        logger.info(f"Final extraction: name={fields.name}, age={fields.age}, gender={fields.gender}, state={fields.state}, category={fields.category}, area_type={fields.area_type}")
    except Exception as e:
        logger.error(f"LLM extraction failed: {e}")
        # Fallback to simple regex if LLM fails
        if doc_type not in ['Caste Certificate', 'Income Certificate']:
            fields.name = extract_name(text)
            dob = extract_dob(text)
            if dob:
                fields.date_of_birth = dob
                fields.age = calculate_age(dob)
            fields.gender = extract_gender(text)

        if doc_type == 'PAN Card':
            fields.pan_number = extract_pan(text)
        elif doc_type == 'Aadhaar Card':
            fields.aadhaar_number = extract_aadhaar(text)
        elif doc_type == 'Caste Certificate':
            fields.category = extract_category(text)
        elif doc_type == 'Income Certificate':
            fields.annual_income = extract_income(text)
            fields.category = extract_category(text)
            
    logger.info(f"Final extraction: name={fields.name}, age={fields.age}, gender={fields.gender}")
    
    return fields
