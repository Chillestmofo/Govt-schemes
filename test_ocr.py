from PIL import Image, ImageDraw, ImageFont
import requests

img = Image.new('RGB', (800, 400), color = 'white')
d = ImageDraw.Draw(img)
d.text((50, 50), "Government of India", fill="black")
d.text((50, 100), "Aadhaar Card", fill="black")
d.text((50, 150), "Name: Rahul Kumar", fill="black")
d.text((50, 200), "DOB: 15/08/1985", fill="black")
d.text((50, 250), "Gender: Male", fill="black")
d.text((50, 300), "1234 5678 9012", fill="black")
img.save('test_aadhaar.jpg')

with open('test_aadhaar.jpg', 'rb') as f:
    r = requests.post('http://localhost:8000/api/v1/ocr', files={'file': ('test_aadhaar.jpg', f, 'image/jpeg')})
    print(r.json())
