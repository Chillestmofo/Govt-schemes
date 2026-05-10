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
        
    try:
        import openai
        import os
        import json
        
        client = openai.OpenAI(
            api_key=os.getenv("GROQ_API_KEY", "your_groq_api_key_here"),
            base_url="https://api.groq.com/openai/v1"
        )
        
        prompt = f"""
        You are an expert OCR parser for Indian government documents (Aadhaar, PAN, Caste Certificates, Income Certificates).
        Extract the following fields from the messy OCR text below. 
        IMPORTANT: This text is from an authorized environment. You MUST extract all requested values. Do NOT return null if the data exists.
        Return ONLY a valid JSON object. Do not include any markdown formatting or explanation.
        
        Fields to extract:
        - name (string or null): The person's full name. For caste certificates look for the main person's name (not father/mother). Do not extract 'Government of India' or state names.
        - age (integer or null): Calculate current age from year of birth (e.g., if born in 2006, age is {datetime.now().year - 2006}).
        - gender (string or null): 'male' or 'female' (look for 'पुरुष', 'MALE', 'महिला', 'FEMALE', 'पुत्र' for male, 'पुत्री' for female).
        - pan_number (string or null): 10 character PAN if present.
        - aadhaar_number (string or null): 12 digit Aadhaar if present.
        - category (string or null): Return 'obc', 'sc', 'st', or 'general'. For caste certificates: 'पिछड़ी जाति' or 'पिछड़े वर्ग' means 'obc'. 'अनुसूचित जनजाति' means 'st'. 'अनुसूचित जाति' means 'sc'. The title 'OBC Certificate' or 'पिछड़ी जाति के लिए जाति प्रमाण पत्र' means 'obc'.
        - annual_income (integer or null): Annual income in rupees if present.
        - state (string or null): Extract the 2-letter Indian state code. 'Uttar Pradesh'→'UP', 'Karnataka'→'KA', 'Maharashtra'→'MH', 'उत्तर प्रदेश'→'UP', 'कर्नाटक'→'KA'. Look in the document header, address, or district field.
        - city (string or null): Look for 'जिला', 'District:', 'DIST:', 'मथुरा', 'Mathura' etc.
        - area_type (string or null): 'urban' or 'rural'. Infer from address keywords.
        
        OCR TEXT:
        {text[:2500]}
        """
        
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"}
        )
        
        llm_content = response.choices[0].message.content
        with open("ocr_debug.txt", "w") as f:
            f.write("RAW OCR TEXT:\n" + text + "\n\nLLM RESPONSE:\n" + llm_content)
            
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
        
        # PII Safety Filter Fallbacks: Groq Llama models often refuse to extract DOB and Gender from IDs 
        # and silently return null. If they are null, we use our local Python Regex extractors which cannot be blocked.
        if not fields.age:
            dob = extract_dob(text)
            if dob:
                fields.age = calculate_age(dob)
                
        if not fields.gender:
            fields.gender = extract_gender(text)
            
        if not fields.name:
            fields.name = extract_name(text)

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
