# 실제 노치 UI 레퍼런스 조사 · 2026-10-19

## 수집 기준과 한계

실제 제품의 공식 페이지와 Apple 원문을 열고, 이미지 검색 결과의 원본 페이지를
대조했다. 외부 이미지는 저장소에 복제하지 않고 원본 링크만 남겼다. 아래
13개는 식별 가능한 제품/화면과 직접 이미지 URL이 있는 자료다. 두 Mac 영상
캡처는 사용자가 제공했으며 [로컬 보드](reference-board/README.md)에 포함했다.
이미지마다 표시 배율, 원본 모니터 크기, 촬영 시점이 달라 논리 px는 추정하지
않는다. **compact 대비 expanded는 대체로 폭과 높이가 함께 증가한다**는
상대 비율만 판단한다. 흐림과 반투명도는 압축 이미지로 정량화할 수 없다.

## A. Mac 노치 유틸리티 5개

| ID | 제품 / 원본 페이지 | 직접 이미지 | 시각 관찰과 GNOME 적용 판단 |
| --- | --- | --- | --- |
| M1 | [NotchNook 공식 press kit](https://getnotchnook.com/press), 2026-10 자료 | [전체 Nook 1920×1080](https://getnotchnook.com/assets/press/notchnook-screenshot-1.jpg) | 상단 노치에서 큰 검은 표면이 아래로 펼쳐진다. 음악·일정처럼 모듈별 명확한 열을 쓴다. Archsport/matci에는 모듈 수와 미디어 장식을 복제하지 않는다. |
| M2 | [boring.notch 제작팀](https://github.com/TheBoredTeam/boring.notch), [제품 갤러리](https://www.producthunt.com/products/theboringnotch) | [제품 갤러리 캡처](https://ph-files.imgix.net/a88f7d8d-d203-46e7-805a-795b56ec002b.png?auto=format&fit=crop) | 검은 바탕의 음악·파일 선반. 작은 닫힌 상태에서 열리는 제품 동작을 확인. 여러 기능과 조밀한 아이콘을 그대로 가져오면 우리 두 앱에 과하다. |
| M3 | [DynamicLake 공식](https://www.dynamiclake.com/) | [공식 음악/노치 이미지](https://framerusercontent.com/images/ILLoeCg2f6ET7kNwJtHpSvlj2U.png?height=840&width=1300) | 큰 콘텐츠를 검은 덩어리 안에 모으고 미니 모드도 제공한다. 확장 폭/높이는 콘텐츠별로 다르다. 외부 디스플레이용 Liquid Glass 설정은 GNOME에서 기본값으로 복제하지 않는다. |
| M4 | [Alcove 제품/제작자 인터뷰](https://appstacks.club/alcove), [제작자 배포 기록](https://github.com/henrikruscon/alcove-releases/releases) | [Alcove 화면](https://framerusercontent.com/images/Oo05sSnTFQFpDUPSS6qCV39p8.webp?height=1198&width=1794) | 알림·Now Playing 중심의 작은 HUD이며 상황에 따라 나타난다. 정적인 350px 패널이 늘 떠 있는 방식과 다르다. 링크는 제3자 제작자 인터뷰의 이미지이므로 원본 앱 픽셀 정확성은 보류. |
| M5 | [MediaMate 제작자 페이지](https://wouter01.github.io/MediaMate/) | [공식 Mac 캡처](https://wouter01.github.io/MediaMate/_app/immutable/assets/macbookpro.747db1dc.png) | 볼륨/밝기/음악의 짧은 HUD가 노치 부근에 붙는다. 신호 1개를 우선 보여주는 밀도를 참고. 우리 앱에서 거대한 음악 조작 위젯은 필요 없다. |

## B. Apple이 게시한 Dynamic Island / Live Activity 사례 5개

다섯 이미지는 모두 [Apple Developer의 실제 앱 사례 기사](https://developer.apple.com/news/?id=mis6swzt)에
실린 자료다. 제품 UI는 각각 Citymapper, Apollo, SmartGym, Flighty,
Wakeout의 것으로, Apple 시스템 UI 자체와 구분한다.

| ID | 사례 / 이미지 | 관찰과 적용 판단 |
| --- | --- | --- |
| A1 | [Citymapper 이동 단계](https://devimages-cdn.apple.com/wwdc-services/articles/images/15C18923-7669-471A-9423-BDCEDB351676/2048.jpeg) | 단계마다 필요한 시간/정류장만 바뀐다. Archsport는 진행 경기의 스코어와 분을 유지하고 다른 일정은 뒤로 보낸다. |
| A2 | [Apollo 댓글 추적](https://devimages-cdn.apple.com/wwdc-services/articles/images/CBD18D2B-CD11-47AC-B05B-589D0FEBCF9A/2048.jpeg) | compact에는 숫자 하나, expanded에서 문맥이 추가된다. matci compact 자체가 없는 현재 정책은 유지 가능하다. |
| A3 | [SmartGym 운동](https://devimages-cdn.apple.com/wwdc-services/articles/images/C961BCFA-CC37-4014-B8C9-01D59DF9155A/2048.jpeg) | 시간/세트 등 현재 단계만 선택한다. 중복 설명 줄이기에 직접 참고. |
| A4 | [Flighty 비행](https://devimages-cdn.apple.com/wwdc-services/articles/images/586703A0-AAF1-4A10-9463-9FF7B94A3022/2048.jpeg) | 시간에 따라 앞세울 정보가 변한다. 경기 전·라이브·종료의 Archsport 화면을 같은 카드에 누적하지 않는다. |
| A5 | [Wakeout 활동](https://devimages-cdn.apple.com/wwdc-services/articles/images/65455445-0232-47ED-A00E-56EB41C14AB8/2048.jpeg) | 아이콘/짧은 문장만으로 한 행동을 유도한다. 버튼 장식보다 현재 상태가 먼저 보여야 한다. |

[Apple Live Activities 문서](https://developer.apple.com/documentation/activitykit/creating-custom-views-for-live-activities)는
Dynamic Island의 검은 배경과 밝은 텍스트를 명시한다. iPhone 센서 주변의
정확한 크기·반경은 물리 노치가 없는 GNOME 화면에 직접 옮기지 않는다.

## C. macOS 시스템 표면 3개

| ID | 출처 / 이미지 | 적용 판단 |
| --- | --- | --- |
| S1 | [macOS Tahoe Control Center](https://www.apple.com/ae/newsroom/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/) · [이미지](https://www.apple.com/newsroom/images/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/article/Apple-WWDC25-macOS-Tahoe-26-Control-Center-250609_big.jpg.large.jpg) | 반투명 재료는 주변을 반영하지만 이 화면은 메뉴형 Control Center다. 노치 본체의 색을 밝게 바꾸는 근거가 아니다. |
| S2 | [macOS Big Sur Control Center](https://www.apple.com/newsroom/2020/06/apple-introduces-macos-big-sur-with-a-beautiful-new-design/) · [이미지](https://www.apple.com/newsroom/images/product/os/macos/standard/apple_macos-bigsur_controlcenter_06222020_carousel.jpg.large.jpg) | 메뉴형 그룹과 조작 간격 참고. 2020년 재료를 2026년 노치 표면의 직접 표준으로 삼지 않는다. |
| S3 | [macOS Big Sur Notification Center](https://www.apple.com/newsroom/2020/06/apple-introduces-macos-big-sur-with-a-beautiful-new-design/) · [이미지](https://www.apple.com/newsroom/images/product/os/macos/standard/apple_macos-bigsur_notificationcenter_06222020_carousel.jpg.large.jpg) | 정보 카드의 계층은 참고 가능하지만 노치 안의 카드 중첩과 상시 스크롤은 피한다. |

## 모션 레퍼런스와 검증 상태

1. [NotchNook 공식 첫 화면](https://getnotchnook.com/)은 닫힌 노치에서 열린
   패널로 이어지는 영상이라고 공식 대체 텍스트가 설명한다. 이 브라우저에서는
   영상 재생이 비활성화돼 프레임과 시간을 재지 못했다.
2. [boring.notch 공식 릴리스](https://github.com/TheBoredTeam/boring.notch/releases/tag/not.humans)는
   hover 확장과 닫힌 상태 조정을 설명하며 MP4 데모를 게시한다. 현재 웹
   수집기에서 영상 프레임을 열 수 없어 실제 easing은 미확인이다.
3. [Apple WWDC23 Design dynamic Live Activities](https://developer.apple.com/videos/play/wwdc2023/10194/?time=660)는
   compact에서 expanded로 커지는 시스템 동작을 다룬다. GNOME용 210ms라는
   수치는 여기서 추출한 것이 아니다.

영상 링크 3개는 확보했으나 재생·프레임 단위 육안 검수 3건은 완료되지 않았다.
따라서 motion 수치는 실험 시작값으로만 취급하고 네이티브 영상 비교 전에는
제품 모션 완료를 선언하지 않는다.

## 종합 판단

- 폭: 참고 제품 모두 고정 대시보드 폭이 아니라 콘텐츠에 따라 달라지는 작은
  닫힌 상태와 큰 열린 상태다. **400–440px은 Apple 공식값이 아니다.** 지금
  Archsport 344/388px, matci 368px을 먼저 유지하고 내용/형태를 비교한다.
- 상단 부착: M1–M5는 물리 노치 또는 최상단 손잡이에서 시작한다. GNOME은
  상단 패널 아래 배치 계약을 보존하면서 상단 모서리를 직각에 가깝게 만든다.
- 재료: Apple Dynamic Island 사례는 검은 표면이 우선이다. 시스템 팝오버의
  밝은/반투명 재료와 분리해서 판단한다.
- 정보/컨트롤: normal 상태에서 설명과 버튼 채움은 줄이고, 경고·검토·오류
  상태의 정보와 명시적 동작은 유지한다.
