"""
Script chính để chạy hệ thống phát hiện video tương đồng
"""
import sys
import os
# Avoid multiple OpenMP runtime initialization on macOS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")
import config

def main_menu():
    print("="*80)
    print("HỆ THỐNG PHÁT HIỆN VIDEO TƯƠNG ĐỒNG")
    print("="*80)
    print("\n1. Trích xuất đặc trưng từ bộ sưu tập video (Bước đầu tiên)")
    print("2. Tìm kiếm video tương đồng")
    print("3. Thoát")
    
    choice = input("\nChọn chức năng (1-3): ")
    return choice

def run_extract_features():
    """
    Bước 1: Trích xuất features từ tất cả video
    """
    print("\n" + "="*80)
    print("TRÍCH XUẤT ĐẶC TRƯNG TỪ VIDEO")
    print("="*80)
    
    if not os.path.exists("../video"):
        print("Lỗi: Không tìm thấy folder ../video")
        return
    
    confirm = input("\nBạn có muốn tiếp tục? Quá trình này có thể mất nhiều thời gian. (y/n): ")
    if confirm.lower() != 'y':
        print("Đã hủy.")
        return
    
    from extract_features import main as extract_main
    try:
        extract_main()
        print("\n✓ Hoàn thành! Bạn có thể tiếp tục với bước tìm kiếm.")
    except Exception as e:
        print(f"\n✗ Lỗi: {e}")

def run_search():
    """
    Bước 2: Tìm kiếm video tương đồng
    """
    print("\n" + "="*80)
    print("TÌM KIẾM VIDEO TƯƠNG ĐỒNG")
    print("="*80)
    
    if not os.path.exists(config.FEATURES_FILE):
        print("\nLỗi: Chưa có dữ liệu đặc trưng!")
        print("Vui lòng chạy bước 1 (Trích xuất đặc trưng) trước.")
        return
    
    video_path = input("\nNhập đường dẫn video cần tìm (hoặc 'q' để thoát): ")
    
    if video_path.lower() == 'q':
        return
    
    if not os.path.exists(video_path):
        print(f"Lỗi: Không tìm thấy file: {video_path}")
        return
    
    from search_video import VideoSearcher
    
    try:
        searcher = VideoSearcher()
        results = searcher.search(video_path, top_k=config.TOP_K)
        searcher.display_results(results)
        
        # Hỏi có muốn tìm lại không
        print("\nBạn có muốn tìm kiếm video khác? (y/n): ", end='')
        if input().lower() == 'y':
            run_search()
    except Exception as e:
        print(f"\n✗ Lỗi: {e}")

def main():
    while True:
        try:
            choice = main_menu()
            
            if choice == '1':
                run_extract_features()
            elif choice == '2':
                run_search()
            elif choice == '3':
                print("\nCảm ơn bạn đã sử dụng hệ thống!")
                break
            else:
                print("\nLựa chọn không hợp lệ!")
            
            if choice in ['1', '2']:
                input("\nNhấn Enter để tiếp tục...")
        
        except KeyboardInterrupt:
            print("\n\nĐã hủy chương trình.")
            break
        except Exception as e:
            print(f"\nLỗi: {e}")
            input("\nNhấn Enter để tiếp tục...")

if __name__ == "__main__":
    main()

