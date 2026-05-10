from PIL import Image, ImageDraw, ImageFont
import requests

img = Image.new('RGB', (800, 400), color = 'white')
d = ImageDraw.Draw(img)
d.text((50, 50), "Government of India", fill="black")
d.text((50, 100), "Aadhaar Card", fill="black")
d.text((50, 150), "Devesh Krishn SO: Neeraj Kumar", fill="black")
d.text((50, 200), "DOB: 02/03/2006", fill="black")
d.text((50, 250), "MALE", fill="black")
d.text((50, 300), "sector 4, radha puram estate, State: Uttar Pradesh, Mathura", fill="black")
img.save('test_aadhaar2.jpg')

with open('test_aadhaar2.jpg', 'rb') as f:
    r = requests.post('http://localhost:8000/api/v1/ocr', files={'file': ('test_aadhaar2.jpg', f, 'image/jpeg')})
    print(r.json())
