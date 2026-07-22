# Development PR smoke test

이 문서는 `feature/t09-pr-smoke`에서 `development`로 보내는 시험 PR에 실제 품질 게이트가 실행되는지 확인하기 위한 무해한 변경이다.

- 제품 코드와 런타임 동작은 변경하지 않는다.
- `quality-gate`의 check, test, typecheck, build가 모두 실행돼야 한다.
- Codex 리뷰는 repository variable과 secret을 활성화하기 전까지 안전하게 건너뛰어야 한다.
- 시험 PR은 사용자 확인 전까지 merge하거나 close하지 않는다.
