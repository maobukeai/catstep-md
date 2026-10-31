#[path = "product-pandoc.rs"]
mod pandoc;
use std::path::{Path, PathBuf};
use serde_json::{json,Value};

fn inputs() -> Vec<String> {
    let prefix=format!("catstep-pandoc-{}-", std::process::id());
    let mut entries=std::fs::read_dir(std::env::temp_dir()).unwrap()
        .filter_map(Result::ok).filter(|entry|entry.file_name().to_string_lossy().starts_with(&prefix))
        .map(|entry|entry.path().to_string_lossy().to_string()).collect::<Vec<_>>();
    entries.sort();entries
}
fn args(config:&Value, name:&str, format:&str) -> pandoc::ExportArgs {
    pandoc::ExportArgs {
        input_markdown:config["markdown"].as_str().unwrap().into(),
        source_dir:Some(config["source"].as_str().unwrap().into()),
        resource_paths:vec![config["extra"].as_str().unwrap().into()],
        format:format.into(),output_path:Path::new(config["output"].as_str().unwrap()).join(name).to_string_lossy().into(),
        bibliography:Some("文献 资料/审计 参考.bib".into()),
        csl:Some("文献 资料/审计 样式.csl".into()),template:None,
        extra_args:vec!["--standalone".into(),"--fail-if-warnings".into()],
    }
}
fn run_case(name:&str, request:pandoc::ExportArgs, expect_success:bool, error_contains:Option<&str>)->Value {
    let output=PathBuf::from(&request.output_path);
    let before=inputs();
    let start=std::time::Instant::now();
    let result=pandoc::pandoc_export_inner(request);
    let after=inputs();
    let error=result.as_ref().err().cloned();
    let correct=result.is_ok()==expect_success && before==after && error_contains.is_none_or(|text|error.as_deref().is_some_and(|error|error.contains(text)));
    json!({"case":name,"expected_success":expect_success,"actual_success":result.is_ok(),"assertion_passed":correct,
      "error":error,"output":output,"output_exists":output.exists(),"output_bytes":output.metadata().ok().map(|m|m.len()),
      "temp_inputs_before":before,"temp_inputs_after":after,"elapsed_ms":start.elapsed().as_millis()})
}
fn main(){
    let path_before=std::env::var_os("PATH");
    let config_path=std::env::args().nth(1).expect("config path");
    let result_path=std::env::args().nth(2).expect("result path");
    let config:Value=serde_json::from_slice(&std::fs::read(config_path).unwrap()).unwrap();
    let executable=Path::new(config["pandoc"].as_str().unwrap());
    // Windows `where` searches this explicit process cwd before unchanged PATH.
    // The product locator/entry still runs unmodified, then anchors child cwd
    // and resource-path to the original note directory.
    std::env::set_current_dir(executable.parent().unwrap()).unwrap();
    let detected=pandoc::pandoc_detect().unwrap().expect("real portable pandoc detected");
    assert_eq!(std::fs::canonicalize(&detected.path).unwrap(),executable.canonicalize().unwrap());
    let mut cases=Vec::new();
    cases.push(run_case("epub_relative_images_bib_csl_different_unicode_directory",args(&config,"A 与源不同/导出 样本.epub","epub"),true,None));
    cases.push(run_case("odt_relative_images_bib_csl_different_unicode_directory",args(&config,"B 空格 中文/导出 样本.odt","odt"),true,None));
    let mut invalid=args(&config,"A 与源不同/failed-option.epub","epub");
    invalid.extra_args.push("--catstep-deliberately-invalid-option".into());
    std::fs::write(&invalid.output_path,"EXISTING-OUTPUT-SENTINEL").unwrap();
    let failed_option=run_case("real_pandoc_invalid_option_cleans_input",invalid,false,Some("Unknown option"));
    assert_eq!(std::fs::read_to_string(failed_option["output"].as_str().unwrap()).unwrap(),"EXISTING-OUTPUT-SENTINEL");
    cases.push(failed_option);
    let mut missing=args(&config,"B 空格 中文/failed-bib.odt","odt");
    missing.bibliography=Some("文献 资料/不存在的文献.bib".into());
    cases.push(run_case("real_pandoc_missing_bibliography_cleans_input",missing,false,Some("pandoc failed:")));
    cases.push(run_case("real_pandoc_creates_nested_output_parent_and_cleans_input",args(&config,"新建 嵌套输出目录/成功 样本.odt","odt"),true,None));
    assert!(cases[3]["error"].as_str().unwrap().contains("源 目录 中文"));
    assert!(cases[3]["error"].as_str().unwrap().contains("不存在的文献.bib"));
    assert_eq!(path_before,std::env::var_os("PATH"));
    let passed=cases.iter().all(|case|case["assertion_passed"]==true);
    let report=json!({"detected":detected,"entry":"pandoc_export_inner","real_process":true,"system_path_modified":false,"active_windows_code_page":unsafe { windows_sys::Win32::Globalization::GetACP() },"cases":cases,"all_driver_assertions_passed":passed});
    std::fs::write(result_path,serde_json::to_string_pretty(&report).unwrap()).unwrap();
    println!("{}",serde_json::to_string_pretty(&report).unwrap());
    if !passed { std::process::exit(1); }
}
