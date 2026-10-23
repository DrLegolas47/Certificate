import csv,secrets,string
from pathlib import Path
import qrcode
from PIL import Image,ImageDraw,ImageFont

QR_DIR="Certi_QRCodes"
CSV_FILE="certificate_codes.csv"

def hex_ok(c):
    try:return c.startswith("#") and len(c) in(4,7) and int(c[1:],16)>=0
    except:return False

def get_code_settings():
    print("\nCode Length and Type")
    print("D = Default (6, Uppercase Alphanumeric)")
    print("M = Manual")

    while 1:
        mode=input("Choose [D/M]: ").strip().upper() or "D"

        if mode=="D":
            return 6,"upper"

        if mode=="M":
            while 1:
                try:
                    length=int(input("Code length: "))
                    if length>0:break
                except:pass
                print("Enter a valid length.")

            print("\nCode type:")
            print("1 = Numeric")
            print("2 = Alphanumeric - Uppercase")
            print("3 = Alphanumeric - Case Sensitive")

            types={"1":"numeric","2":"upper","3":"mixed"}

            while 1:
                t=input("Choose [1/2/3]: ").strip()
                if t in types:return length,types[t]
                print("Invalid choice.")

        print("Enter D or M.")

def gen(prefix,length,typ,used):
    if typ=="numeric":
        chars=string.digits
    elif typ=="upper":
        chars=string.ascii_uppercase+string.digits
    else:
        chars=string.ascii_letters+string.digits

    while 1:
        code=prefix+"".join(secrets.choice(chars) for _ in range(length))
        if code not in used:
            used.add(code)
            return code

def make_qr(data, text, path, fg, bg, transparent):

    q = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=1
    )

    q.add_data(data)
    q.make(fit=True)

    qr_bg = (255,255,255,0) if transparent else bg

    im = q.make_image(
        fill_color=fg,
        back_color=qr_bg
    ).convert("RGBA")

    w, h = im.size

    # -----------------------------------------------------
    # FONT
    # -----------------------------------------------------

    font = None

    font_paths = [
        r"C:\Windows\Fonts\Inter-Regular.ttf",
        r"C:\Windows\Fonts\Inter_18pt-Regular.ttf",
        r"C:\Windows\Fonts\Inter-Bold.ttf",
        r"C:\Windows\Fonts\Inter_18pt-Bold.ttf",
        r"C:\Windows\Fonts\courbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
    ]

    for fp in font_paths:
        try:
            font = ImageFont.truetype(fp, 24)
            break
        except:
            pass

    if font is None:
        font = ImageFont.load_default()


    # -----------------------------------------------------
    # TEXT SIZE
    # -----------------------------------------------------

    dummy = ImageDraw.Draw(im)

    box = dummy.textbbox(
        (0, 0),
        text,
        font=font
    )

    tw = box[2] - box[0]
    th = box[3] - box[1]


    # Only 4 px gap between QR and text
    gap = 2

    final_h = h + th + gap + 4

    final = Image.new(
        "RGBA",
        (w, final_h),
        qr_bg
    )

    final.paste(im, (0, 0))


    # -----------------------------------------------------
    # TEXT
    # -----------------------------------------------------

    draw = ImageDraw.Draw(final)

    x = (w - tw) // 2
    y = h + gap - box[1]

    draw.text(
        (x, y),
        text,
        font=font,
        fill=fg
    )


    # -----------------------------------------------------
    # SAVE
    # -----------------------------------------------------

    final.save(
        path,
        "PNG"
    )


def main():

    print("\n==============================================")
    print("       Certificate QR Code Generator")
    print("==============================================")

    # -----------------------------------------------------
    # OUTPUT MODE
    # -----------------------------------------------------

    print("\nChoose output:")
    print("1 = Create CSV only")
    print("2 = Create CSV and QR codes")
    while True:
        output_mode = input("Choose [1/2]: ").strip()
        if output_mode in ("1", "2"):
            break
        print("Invalid choice. Enter 1 or 2.")
    create_qr = output_mode == "2"

    # -----------------------------------------------------
    # CODE LENGTH AND TYPE
    # -----------------------------------------------------

    length,typ=get_code_settings()

    type_name={
        "numeric":"Numeric",
        "upper":"Uppercase Alphanumeric",
        "mixed":"Case-sensitive Alphanumeric"
    }[typ]

    print(f"\nCode length : {length}")
    print(f"Code type   : {type_name}")

    # -----------------------------------------------------
    # QR PREFIX (only needed when creating QR codes)
    # -----------------------------------------------------

    if create_qr:
        qr_prefix=input("\nQR prefix (optional, press Enter for none): ")
    else:
        qr_prefix = ""

    # -----------------------------------------------------
    # CODE PREFIX
    # Optional - press Enter to use no code prefix
    # -----------------------------------------------------

    code_prefix=input("Code prefix (optional, press Enter for none): ").strip()

    print(f"\nQR prefix   : {qr_prefix if qr_prefix else '[none]'}")
    print(f"Code prefix : {code_prefix if code_prefix else '[none]'}")

    # -----------------------------------------------------
    # NUMBER OF CODES
    # -----------------------------------------------------

    while 1:
        try:
            n=int(input("Number of QR codes: "))
            if n>0:break
        except:pass

        print("Enter a valid number greater than 0.")

    # -----------------------------------------------------
    # QR APPEARANCE (only needed when creating QR codes)
    # -----------------------------------------------------

    if create_qr:
        while 1:
            fg=input("Foreground HEX [#000000]: ").strip() or "#000000"
            if hex_ok(fg):
                break
            print("Invalid HEX colour.")

        transparent=input(
            "Transparent background? (y/n) [n]: "
        ).strip().lower() in ("y","yes")

        if transparent:
            bg="#FFFFFF"
        else:
            while 1:
                bg=input("Background HEX [#FFFFFF]: ").strip() or "#FFFFFF"
                if hex_ok(bg):
                    break
                print("Invalid HEX colour.")

    # -----------------------------------------------------
    # OUTPUT
    # -----------------------------------------------------

    root=Path(__file__).resolve().parent
    qr_dir=root/QR_DIR
    if create_qr:
        qr_dir.mkdir(parents=True,exist_ok=True)

    used=set()
    rows=[]

    print(f"\nGenerating {n} random codes...")

    for i in range(n):

        # Code prefix + selected random code
        code=gen(
            code_prefix,
            length,
            typ,
            used
        )

        # QRData is the data encoded in the QR. In CSV-only mode,
        # it contains the generated code because no QR prefix is used.
        qr_data=qr_prefix+code

        if create_qr:
            make_qr(
                qr_data,
                code,
                qr_dir/f"{code}.png",
                fg,bg,transparent
            )

        rows.append([code,qr_data])

        if (i+1)%100==0:
            print(f"{i+1}/{n}")

    # -----------------------------------------------------
    # CSV
    # -----------------------------------------------------

    csv_path=root/CSV_FILE

    with csv_path.open(
        "w",
        newline="",
        encoding="utf-8"
    ) as f:
        w=csv.writer(f)
        w.writerow(["Code","QRData"])
        w.writerows(rows)

    print("\n==============================================")
    print("Generation complete!")
    print("==============================================")
    print(f"Code length : {length}")
    print(f"Code type   : {type_name}")
    if create_qr:
        print(f"QRs         : {qr_dir}")
    else:
        print("QRs         : Not created (CSV-only mode)")
    print(f"CSV         : {csv_path}")
    print("==============================================")


if __name__=="__main__":
    main()