namespace EmployeeVoice.Api.Infrastructure;

public sealed class ApiException : Exception
{
    public int StatusCode { get; }
    public string Title { get; }
    public string Code { get; }

    public ApiException(int statusCode, string title, string detail, string code)
        : base(detail)
    {
        StatusCode = statusCode;
        Title = title;
        Code = code;
    }
}
