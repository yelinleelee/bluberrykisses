# BluberryKisses 웨딩마을

결혼식 하객들이 링크 하나로 들어와 캐릭터를 만들고, 마을을 돌아다니며 퀘스트 3개를 마치면 럭키드로우에 자동 응모되는 웹게임이에요.

- 프론트: 빌드 과정 없는 정적 사이트 (`index.html` 하나 + `bk-store.js`)
- 저장소·실시간: Supabase (하객마다 익명 로그인, 권한은 `supabase/schema.sql` 규칙이 지킴)
- 배포: Vercel

## 폴더 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 게임 전체 (로딩, 꾸미기, 마을, 퀘스트, 방명록, 케이크, 포토존, 호스트 페이지, 타임랩스) |
| `bk-store.js` | 게임과 Supabase를 잇는 연결 코드 |
| `config.js` | Supabase 주소와 공개 키를 넣는 곳 |
| `supabase/schema.sql` | 테이블, 권한 규칙, 호스트 비밀번호 설정 |
| `assets/` | 마을 배경 그림, 케이크 테이블 그림, 아이콘 |
| `vercel.json` | Vercel 캐시 설정 |

## 설치 순서

### 1. Supabase 프로젝트 만들기
1. https://supabase.com 에서 가입하고 New project를 만들어요. 지역은 Northeast Asia (Seoul)을 고르면 빨라요.
2. 왼쪽 메뉴 Authentication → Sign In / Providers → **Anonymous Sign-Ins를 켜요.** (하객이 가입 없이 들어오게 해주는 설정이라 꼭 필요해요)

### 2. 테이블과 권한 만들기
1. 왼쪽 메뉴 SQL Editor → New query
2. `supabase/schema.sql` 내용을 전부 붙여넣어요.
3. 맨 아래쪽 `'blueberry-1234'`를 **신랑신부만 아는 호스트 비밀번호로 바꾼 뒤** Run을 눌러요.
   - 비밀번호를 나중에 바꾸고 싶으면 그 `insert ... on conflict` 문장만 다시 실행하면 돼요.

### 3. 설정 파일 채우기
1. Supabase 왼쪽 메뉴 Project Settings → API (또는 Data API)
2. Project URL과 anon public key를 복사해서 `config.js`에 넣어요.

```js
window.BK_CONFIG = {
  supabaseUrl: "https://abcdefgh.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

anon key는 원래 브라우저에 공개되는 키라 GitHub에 올려도 괜찮아요. 하객이 남의 데이터를 바꾸지 못하게 하는 건 2단계의 권한 규칙이 맡아요. (service_role 키는 절대 넣지 마세요)

### 4. Vercel에 배포하기
1. 이 폴더를 GitHub 저장소에 올려요.
2. https://vercel.com → Add New → Project → 그 저장소를 Import
3. Framework Preset은 **Other**, Build Command와 Output Directory는 비워두고 Deploy
4. 나온 주소(예: `bluberrykisses.vercel.app`)가 하객용 링크예요. 청첩장이나 식장 QR코드에 이 주소를 넣으면 돼요.

## 결혼식 당일 쓰는 법

### 호스트로 들어가기
- 하객용 주소 끝에 `#host`를 붙여서 열어요. 예: `https://bluberrykisses.vercel.app/#host`
- 캐릭터를 만들고 입장하면 호스트 비밀번호 창이 떠요. 맞게 넣으면 새로고침되면서 상단에 노란 왕관 아이콘이 생겨요.
- 신랑님 폰, 예린님 폰, 식장 노트북처럼 기기마다 한 번씩 하면 돼요.

### 호스트 페이지에서 할 수 있는 것
- 입장 하객 수, 응모자 수, 케이크 조각 수, 방명록 수 보기
- 응모자 명단(응모 순서, 시각) 보기와 이름 검색
- 럭키드로우: 한 번에 1~3명, 이미 당첨된 사람 빼고 뽑기, 회차별 당첨 기록
- 발표 모드: 식장 스크린에 연결한 노트북에서 누르면 당첨자 이름이 화면 가득 떠요
- 방명록 숨기기 / 다시 보이기
- 타임랩스 기록 시작·멈추기, 재생

### 타임랩스
- 식장 노트북에서 호스트 페이지를 열고 "기록 시작"을 눌러요. 1분마다 마을 모습을 저장해요.
- 노트북을 충전기에 꽂고, 화면이 꺼지지 않게 해주세요. (기록은 호스트 화면이 켜진 기기에서만 저장돼요)
- 끝나면 "타임랩스 재생"으로 몇 시간을 몇 분으로 압축해서 볼 수 있어요. 이 화면을 화면 녹화하면 기념 영상이 돼요.

## 테스트 데이터 지우기
리허설로 테스트한 뒤 실제 결혼식 전에 Supabase SQL Editor에서 실행해요.

```sql
delete from public.docs;
delete from public.hosts;
```

호스트 비밀번호는 지워지지 않아요. 호스트 기기들은 다시 `#host`로 로그인하면 돼요.

## 미리 알아두면 좋은 점
- Supabase 무료 플랜으로 시작할 수 있어요. 다만 무료 플랜은 동시 접속과 실시간 메시지 수에 한도가 있으니, 하객이 100명 가까이 될 것 같으면 결혼식 전에 Supabase 대시보드의 Usage에서 한도를 확인하고, 필요하면 결혼식 기간에만 Pro로 올리는 걸 권해요.
- 무료 플랜 프로젝트는 일주일 넘게 아무도 안 쓰면 일시정지될 수 있어요. 결혼식 며칠 전에 한 번 접속해서 깨워두세요.
- 하객 캐릭터와 퀘스트 진행은 기기(브라우저)마다 저장돼요. 같은 사람이 다른 폰으로 들어오면 새 하객으로 보여요.
- `config.js`를 비워둔 채로 열면 저장소 없이 혼자 해보는 연습 모드로 돌아가요. 이때는 왕관 아이콘이 누구에게나 보여요.

## 로컬에서 미리 보기
```bash
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000
```
